import express from "express";
import cors from "cors";
import path from "path";
import compression from "compression";
import zlib from "zlib";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

// Enable Brotli and Gzip compression middleware in production
if (isProduction) {
  app.use(
    compression({
      level: 6,
      threshold: 512,
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) {
          return false;
        }
        return compression.filter(req, res);
      },
      brotli: {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        },
      },
    })
  );
}

// Ensure proper HTTP headers for CDN edge caching and Acceptance negotiation
app.use((req, res, next) => {
  res.setHeader("Vary", "Accept-Encoding");
  next();
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const isAllowedMapsHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  if (
    host === "maps.app.goo.gl" ||
    host === "goo.gl" ||
    host === "g.co" ||
    host === "maps.apple.com"
  ) {
    return true;
  }
  return /^(?:www\.|maps\.)?google\.[a-z.]{2,10}$/i.test(host);
};

const validateLatLngPair = (
  latVal: number,
  lngVal: number
): { latitude: number; longitude: number } | null => {
  if (
    Number.isFinite(latVal) &&
    Number.isFinite(lngVal) &&
    latVal !== 0 &&
    lngVal !== 0 &&
    latVal >= -90 &&
    latVal <= 90 &&
    lngVal >= -180 &&
    lngVal <= 180
  ) {
    return {
      latitude: Number(latVal.toFixed(6)),
      longitude: Number(lngVal.toFixed(6)),
    };
  }
  return null;
};

const extractCoordsFromMapsText = (
  input: string
): { latitude: number; longitude: number } | null => {
  if (!input) return null;
  let normalized = input;
  try {
    normalized = decodeURIComponent(input);
  } catch {
    // keep raw if malformed URI sequence
  }
  normalized = normalized.replace(/\\u0026/g, "&").replace(/&amp;/g, "&");

  // 1. Google Maps exact place pin: !3dLAT!4dLNG
  const dataPinMatch = normalized.match(
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/
  );
  if (dataPinMatch) {
    const valid = validateLatLngPair(
      Number(dataPinMatch[1]),
      Number(dataPinMatch[2])
    );
    if (valid) return valid;
  }

  // 2. Google Maps viewport / search / place path: @LAT,LNG or /search/LAT,LNG
  const atMatch = normalized.match(
    /(?:@|\/maps\/search\/|\/maps\/place\/)(-?\d{1,3}(?:\.\d+)?)\s*[,+]\s*(-?\d{1,3}(?:\.\d+)?)/
  );
  if (atMatch) {
    const valid = validateLatLngPair(Number(atMatch[1]), Number(atMatch[2]));
    if (valid) return valid;
  }

  // 3. Query params: ?q=LAT,LNG, ll=LAT,LNG, center=LAT,LNG, daddr=LAT,LNG, query=LAT,LNG
  const queryMatch = normalized.match(
    /[?&](?:q|ll|center|daddr|saddr|query)=(-?\d{1,3}(?:\.\d+)?)\s*(?:,|\+|%2C)\s*(-?\d{1,3}(?:\.\d+)?)/i
  );
  if (queryMatch) {
    const valid = validateLatLngPair(
      Number(queryMatch[1]),
      Number(queryMatch[2])
    );
    if (valid) return valid;
  }

  return null;
};

const resolveSingleMapsUrl = async (
  rawUrl: string
): Promise<{
  latitude: number | null;
  longitude: number | null;
  resolvedUrl?: string;
}> => {
  try {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) return { latitude: null, longitude: null };

    const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
    const targetStr = urlMatch ? urlMatch[0].replace(/[),.;]+$/, "") : trimmed;
    const parsedUrl = new URL(targetStr);

    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      !isAllowedMapsHost(parsedUrl.hostname)
    ) {
      return { latitude: null, longitude: null };
    }

    const directCoords = extractCoordsFromMapsText(parsedUrl.toString());
    if (directCoords) {
      return { ...directCoords, resolvedUrl: parsedUrl.toString() };
    }

    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const finalUrl = response.url || parsedUrl.toString();
    const urlCoords = extractCoordsFromMapsText(finalUrl);
    if (urlCoords) {
      return { ...urlCoords, resolvedUrl: finalUrl };
    }

    const bodyText = (await response.text()).slice(0, 250000);
    const bodyCoords = extractCoordsFromMapsText(bodyText);
    if (bodyCoords) {
      return { ...bodyCoords, resolvedUrl: finalUrl };
    }

    return { latitude: null, longitude: null, resolvedUrl: finalUrl };
  } catch {
    return { latitude: null, longitude: null };
  }
};

app.post("/api/resolve-maps-url", async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || "");
    const result = await resolveSingleMapsUrl(rawUrl);
    if (result.latitude !== null && result.longitude !== null) {
      res.json({
        success: true,
        latitude: result.latitude,
        longitude: result.longitude,
        resolvedUrl: result.resolvedUrl,
        formatted: `${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`,
      });
    } else {
      res.json({
        success: false,
        latitude: null,
        longitude: null,
        resolvedUrl: result.resolvedUrl,
        error: "لم يتم العثور على إحداثيات داخل الرابط.",
      });
    }
  } catch {
    res.status(400).json({ success: false, latitude: null, longitude: null });
  }
});

app.post("/api/resolve-maps-urls", async (req, res) => {
  try {
    const rawUrls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const uniqueUrls: string[] = Array.from(
      new Set(
        rawUrls
          .map((u: unknown) => String(u || "").trim())
          .filter((u: string) => u.length > 0)
      )
    ).slice(0, 500);

    const results: Record<
      string,
      { latitude: number | null; longitude: number | null; resolvedUrl?: string }
    > = {};

    const CONCURRENCY = 10;
    for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
      const chunk = uniqueUrls.slice(i, i + CONCURRENCY);
      const resolvedChunk = await Promise.all(
        chunk.map(async (u) => ({ url: u, res: await resolveSingleMapsUrl(u) }))
      );
      resolvedChunk.forEach(({ url, res: r }) => {
        results[url] = r;
      });
    }

    res.json({ success: true, results });
  } catch {
    res.status(400).json({ success: false, results: {} });
  }
});

async function startServer() {
  let viteServer: Awaited<ReturnType<typeof createViteServer>> | null = null;

  if (!isProduction) {
    const vitePromise = createViteServer({
      configFile: path.resolve(process.cwd(), "vite.config.ts"),
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        allowedHosts: true,
      },
      appType: "spa",
    }).then((server) => {
      viteServer = server;
      return server;
    });

    app.use(async (req, res, next) => {
      try {
        const vite = viteServer ?? (await vitePromise);
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });

    vitePromise.catch((err) => {
      console.error("Failed to initialize Vite dev middleware:", err);
      process.exit(1);
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(
      express.static(distPath, {
        maxAge: "1y",
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      })
    );
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    httpServer.close(() => {
      if (viteServer) {
        viteServer.close().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

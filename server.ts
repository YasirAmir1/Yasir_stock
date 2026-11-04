import express from "express";
import cors from "cors";
import path from "path";
import compression from "compression";
import zlib from "zlib";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

// Enable Brotli and Gzip compression middleware for text assets, HTML, CSS, JS, and JSON API payloads
app.use(
  compression({
    level: 6, // Quality level for Gzip / dynamic responses
    threshold: 512, // Compress responses > 512 bytes
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },
    brotli: {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5, // Brotli quality level 5 for dynamic responses to balance CPU & compression density
      },
    },
  })
);

// Ensure proper HTTP headers for CDN edge caching and Acceptance negotiation
app.use((req, res, next) => {
  res.setHeader("Vary", "Accept-Encoding");
  next();
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      configFile: path.resolve(process.cwd(), "vite.config.ts"),
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

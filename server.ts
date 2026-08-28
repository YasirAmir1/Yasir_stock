import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const DATA_FILE = path.join(process.cwd(), "data.json");

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("Error reading data.json:", err);
  }
  return {
    sales_entries: [],
    inventory_items: [],
    delegate_targets: [],
    delegate_accounts: [],
    target_locks: {},
  };
}

function writeData(data: any) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing data.json:", err);
  }
}

app.get("/api/data", (req, res) => {
  const data = readData();
  res.json(data);
});

app.post("/api/data", (req, res) => {
  const { collection, id, item, items } = req.body;
  const data = readData();

  if (!data[collection]) {
    data[collection] = Array.isArray(items) ? [] : {};
  }

  if (Array.isArray(items)) {
    data[collection] = items;
  } else if (id !== undefined && item !== undefined) {
    if (Array.isArray(data[collection])) {
      const idx = data[collection].findIndex((i: any) => i.id === id || i.username === id || i.delegateName === id);
      if (idx >= 0) {
        data[collection][idx] = { ...data[collection][idx], ...item };
      } else {
        data[collection].push(item);
      }
    } else {
      data[collection][id] = item;
    }
  }

  writeData(data);
  res.json({ status: "success", data: data[collection] });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

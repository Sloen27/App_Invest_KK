import { handleApiRequest } from "../lib/app-api.js";

export default async function handler(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `https://${host}`);
    await handleApiRequest(req, res, url);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Internal server error", details: error.message }));
  }
}

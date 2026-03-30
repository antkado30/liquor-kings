export function requireServiceRole(req, res, next) {
  if (req.auth_mode !== "service_role") {
    return res.status(403).json({ error: "Service role required" });
  }
  next();
}

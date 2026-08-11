const fs = require("fs");
const path = require("path");

exports.findOnPath = (name, env = process.env) => {
  const extensions =
    process.platform === "win32" ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of ["", ...extensions]) {
      const candidate = path.join(dir, name + extension);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
};

const ASSETS = {
  "win32-x64": "marksman.exe",
  "darwin-x64": "marksman-macos",
  "darwin-arm64": "marksman-macos",
  "linux-x64": "marksman-linux-x64",
  "linux-arm64": "marksman-linux-arm64",
};

exports.assetFor = ({ platform, arch }) => ASSETS[`${platform}-${arch}`] || null;

exports.managedServer = {
  source: "github-release",
  displayName: "Marksman",
  repository: "artempyanykh/marksman",
  assetFor: exports.assetFor,
  assetType: "binary",
  // Marksman publishes raw executables but no checksum sidecars. Keeping this
  // explicit prevents the installer from silently implying verification.
  checksum: "none",
  binary: process.platform === "win32" ? "marksman.exe" : "marksman",
};

exports.resolveServer = async (configuredPath, managed = null) => {
  if (configuredPath) {
    await fs.promises.access(configuredPath, fs.constants.X_OK);
    return { command: configuredPath, args: ["server"] };
  }
  if (managed?.binaryPath) {
    return { command: managed.binaryPath, args: ["server"], version: managed.version };
  }
  const command = exports.findOnPath("marksman");
  return command ? { command, args: ["server"] } : null;
};

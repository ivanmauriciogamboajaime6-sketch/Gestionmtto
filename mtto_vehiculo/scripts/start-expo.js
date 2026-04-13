const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

function getLanIp() {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
}

const lanIp = getLanIp();
const args = process.argv.slice(2);
const env = { ...process.env };

if (lanIp) {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = lanIp;
  console.log(`Using Expo LAN IP ${lanIp}`);
} else {
  console.warn("No LAN IPv4 detected. Expo will use its default host resolution.");
}

const child = spawn("npx expo start " + args.map((arg) => `"${arg}"`).join(" "), {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

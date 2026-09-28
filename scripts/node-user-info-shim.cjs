const os = require("node:os");

// Fall back only when libuv cannot resolve the current Windows account. Tools
// such as tsx need only a stable username and home directory for temp files.
try {
  os.userInfo();
} catch {
  const username = process.env.USERNAME || process.env.USER || "local-user";
  const homedir = process.env.USERPROFILE || os.homedir();
  os.userInfo = () => ({
    uid: -1,
    gid: -1,
    username,
    homedir,
    shell: null,
  });
}

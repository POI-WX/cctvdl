// Wraps decrypt.js: patches child_process to add windowsHide + redirect ffmpeg to
// the bundled binary, then loads the ESM module via dynamic import.
const childProcess = require('child_process');
const path = require('path');
const { resolveFfmpegCommand } = require('./ffmpeg-redirect');

// Patch spawn to add windowsHide on Windows and redirect bare `ffmpeg` to the
// bundled ffmpeg-static binary (path passed in via CCTVDL_FFMPEG) so users don't
// need ffmpeg on their PATH.
const originalSpawn = childProcess.spawn;
childProcess.spawn = function(cmd, args, options) {
  const opts = options || {};
  if (process.platform === 'win32') {
    opts.windowsHide = true;
  }
  return originalSpawn.call(this, resolveFfmpegCommand(cmd), args, opts);
};

const originalExec = childProcess.exec;
childProcess.exec = function(cmd, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const opts = options || {};
  if (process.platform === 'win32') {
    opts.windowsHide = true;
  }
  return originalExec.call(this, cmd, opts, callback);
};

const originalExecSync = childProcess.execSync;
childProcess.execSync = function(cmd, options) {
  const opts = options || {};
  if (process.platform === 'win32') {
    opts.windowsHide = true;
  }
  return originalExecSync.call(this, cmd, opts);
};

// decrypt.js uses ESM import() internally, must load via dynamic import
// On Windows, import() requires file:// URLs, not raw paths
const { pathToFileURL } = require('url');
const decryptPath = path.join(__dirname, 'decrypt.js');
const decryptURL = pathToFileURL(decryptPath).href;
import(decryptURL).catch(err => {
  console.error('Failed to load decrypt.js:', err);
  process.exit(1);
});

// Part of our wrapper layer (modifiable — unlike decrypt.js / cctv_wasm.js).
//
// decrypt.js shells out to a bare `ffmpeg` command, which would require the user
// to have ffmpeg on their PATH. To keep the app zero-config, the main process
// passes the bundled ffmpeg-static path down via the CCTVDL_FFMPEG env var, and
// this helper rewrites decrypt.js's `spawn('ffmpeg', ...)` calls to use it.
'use strict';

/**
 * If `cmd` is the bare ffmpeg executable and a bundled binary was provided via
 * the CCTVDL_FFMPEG env var, return that absolute path; otherwise return `cmd`
 * unchanged (e.g. a developer relying on a system ffmpeg on PATH).
 */
function resolveFfmpegCommand(cmd, env) {
  env = env || process.env;
  const bundled = env.CCTVDL_FFMPEG;
  if (!bundled || typeof cmd !== 'string') return cmd;
  // Match a bare invocation: "ffmpeg" or "ffmpeg.exe" (no directory component).
  const base = cmd.replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (base === 'ffmpeg' || base === 'ffmpeg.exe') return bundled;
  return cmd;
}

module.exports = { resolveFfmpegCommand };

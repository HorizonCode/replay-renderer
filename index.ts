import { spawn } from "child_process";
import { promises } from "fs";
import { ScoreDecoder } from "osu-parsers";
import path from "path";
import * as cliProgress from 'cli-progress';

const replayId = 3488591;

const danserExecuteable = path.join(__dirname, process.platform == "win32" ? "bin-win" : "bin", "danser-cli.exe");
const replaysFolder = path.join(__dirname, "data", "replays");
const songsFolder = path.join(__dirname, "data", "songs");
const exportFolder = path.join(__dirname, "data", "export");

(async () => {
  if (process.platform != "win32" && process.platform == "linux") {
    console.log(`The platform ${process.platform} is not compatible.`);
    return;
  }
  console.log("Downloading replay...");
  const replayDownload = await fetch(`https://api.ez-pp.farm/get_replay?id=${replayId}`);
  if (!replayDownload.ok) return;
  const replayArray = await replayDownload.arrayBuffer();
  const replayFile = path.join(replaysFolder, `${replayId}.osr`);
  await promises.writeFile(replayFile, Buffer.from(replayArray));
  console.log("replay saved!");
  console.log("Parsing replay...");
  const scoreDecoder = new ScoreDecoder();
  const parsedScore = await scoreDecoder.decodeFromPath(replayFile, false);
  console.log("replay parsed!");
  const beatmapHash = parsedScore.info.beatmapHashMD5;
  console.log("Getting BeatmapSet info...");
  const beatmapDataRequest = await fetch(`https://api.osu.direct/v2/md5/${beatmapHash}`);
  if (!beatmapDataRequest.ok) return;
  const beatmapData = await beatmapDataRequest.json();
  console.log("got beatmapset info!");
  const beatmapSetId = beatmapData.beatmapset_id;
  console.log("Downloading BeatmapSet...");
  const beatmapSetDownloadRequest = await fetch(`https://api.osu.direct/d/${beatmapSetId}?noVideo`);
  if (!beatmapSetDownloadRequest.ok) return;
  const beatmapSetArray = await beatmapSetDownloadRequest.arrayBuffer();
  const setFile = path.join(songsFolder, `${beatmapSetId}.osz`);
  await promises.writeFile(setFile, Buffer.from(beatmapSetArray));
  console.log("BeatmapSet saved!");
  console.log("rendering replay...\n");
  const progress = new cliProgress.SingleBar({
    barCompleteChar: '+',
    barIncompleteChar: '-',
    format: "[{bar}] {percentage}% | ETA: {eta}s"
  });
  progress.start(100, 0);
  const danserProcess = spawn(danserExecuteable, [`-skin=Rafis`, `-out=${replayId}`, `-md5=${beatmapHash}`, `-r=${replayFile}`, `-preciseprogress`])
  danserProcess.stdout.on('data', function (data) {
    const line: string = data.toString().trim();
    if (line.includes("Progress")) {
      const percentage = line.match(/(\d+)%/g);
      if (percentage) {
        const percentageInt = parseInt(percentage[0].substring(0, percentage[0].length - 1));
        progress.update(percentageInt);
      }
    }
  });

  danserProcess.on('exit', function (code) {
    if (code)
      console.log('\n\nchild process exited with code ' + code.toString());
    else console.log('\n\nreplay rendered!');

    progress.stop();
  });
})();
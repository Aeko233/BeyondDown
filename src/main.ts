import "./style.css";
import { loadConfig } from "./config";
import { bindAuthEvents, refreshMe } from "./features/auth";
import { bindExportEvents } from "./features/exports";
import { bindVideoEvents } from "./features/video";

async function main(): Promise<void> {
  await loadConfig();
  bindAuthEvents();
  bindVideoEvents();
  bindExportEvents();
  await refreshMe();
}

void main();

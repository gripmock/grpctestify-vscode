import { EventEmitter } from "vscode";

export const onDidChangeLspDegraded = new EventEmitter<boolean>();
export let isLspDegraded = false;

onDidChangeLspDegraded.event((degraded) => {
  isLspDegraded = degraded;
});

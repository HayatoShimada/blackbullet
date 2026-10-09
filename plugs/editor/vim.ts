import { clientStore, editor } from "@silverbulletmd/silverbullet/syscalls";

export async function toggleVimMode() {
  // From what is on now: vim can be on without a stored choice (the default).
  const vimMode = !(await editor.getUiOption("vimMode"));
  await editor.setUiOption("vimMode", vimMode);
  await clientStore.set("vimMode", vimMode);
}

export async function loadVimConfig() {
  const vimMode = await editor.getUiOption("vimMode");
  if (!vimMode) {
    console.log("Not in vim mode");
    return;
  }
  try {
    await editor.save();
    await editor.reloadConfigAndCommands();
    await editor.configureVimMode();
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}

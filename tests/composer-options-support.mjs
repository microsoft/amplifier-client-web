// Keep one picker and its pending choices mounted throughout the interaction.
export const composerOptionsPanel=page=>page.getByRole('dialog',{name:'Model for this chat',exact:true});
export async function showComposerOptionWith(expect,page,section){
 if(!['model','provider','advanced','effort','bundle'].includes(section))throw Error('Unknown composer option: '+section);
 const dialog=composerOptionsPanel(page);
 await expect(dialog).toHaveCount(1);
 await expect(dialog).toBeVisible();
 if(['advanced','bundle'].includes(section)){
  const advanced=dialog.locator('details.a-picker-advanced');
  if(await advanced.getAttribute('open')===null)await advanced.locator(':scope > summary').click();
  if(section==='advanced'){await expect(advanced).toHaveAttribute('open','');return}
 }
 // An unsupported effort or loading catalog may present a status in place of an input.
 await expect(dialog.locator('[data-composer-page="'+section+'"]')).toBeVisible();
}

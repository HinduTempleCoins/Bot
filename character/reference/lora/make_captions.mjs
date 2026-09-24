import fs from 'node:fs'; import path from 'node:path';
const D='/workspaces/Bot/character/reference';
const base='hathor, a vaporwave popart angel goddess, VR oculus headset over the eyes, heavy curling ram horns, Hathor-Mehit headdress, large pink and blue feathered wings, wesekh gold collar, gold cuffs, dark blue-black lipstick, long dark hair, white sheer linen';
const skin={ '01':'lavender periwinkle skin','original-source':'lavender periwinkle skin' };
const files=fs.readdirSync(D).filter(f=>/\.(png|webp|jpg|jpeg)$/i.test(f));
let n=0;
for(const f of files){ const stem=f.replace(/\.[^.]+$/,''); const key=stem.replace('hathor-2026-06-20-','').replace('hathor-','');
  const cap=base+', '+(skin[key]||'lavender or tan skin')+', highly detailed'; 
  fs.writeFileSync(path.join(D,'lora',stem+'.txt'),cap); n++; }
console.log('wrote',n,'caption files');

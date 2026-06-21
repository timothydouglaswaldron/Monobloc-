const f="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";function p(e,t,i="untitled"){return{name:i,w:e,h:t,palette:[],pixels:Array.from({length:t},()=>".".repeat(e))}}function a(e,t,i){if(t<0||t>=e.w||i<0||i>=e.h)return null;const l=e.pixels[i][t];if(l===".")return null;const r=f.indexOf(l);return r>=0?e.palette[r]:null}function u(e,t,i,l){if(t<0||t>=e.w||i<0||i>=e.h)return;let r=".";if(l){let s=e.palette.indexOf(l);if(s<0){if(e.palette.length>=f.length)return;e.palette.push(l),s=e.palette.length-1}r=f[s]}const n=e.pixels[i];n[t]!==r&&(e.pixels[i]=n.slice(0,t)+r+n.slice(t+1))}function o(e){const t=new Set;for(const n of e.pixels)for(const s of n)s!=="."&&t.add(s);const i=[...t].map(n=>f.indexOf(n)).filter(n=>n>=0).sort((n,s)=>n-s),l={},r=[];i.forEach(n=>{l[f[n]]=f[r.length],r.push(e.palette[n])}),e.pixels=e.pixels.map(n=>[...n].map(s=>s==="."?".":l[s]).join("")),e.palette=r}function x(e){let t=e.w,i=e.h,l=-1,r=-1;for(let n=0;n<e.h;n++)for(let s=0;s<e.w;s++)a(e,s,n)&&(s<t&&(t=s),s>l&&(l=s),n<i&&(i=n),n>r&&(r=n));return l<0?{x0:0,y0:0,x1:e.w-1,y1:e.h-1,w:e.w,h:e.h}:{x0:t,y0:i,x1:l,y1:r,w:l-t+1,h:r-i+1}}function w(e){const t=document.createElement("canvas");t.width=e.w,t.height=e.h;const i=t.getContext("2d");for(let l=0;l<e.h;l++)for(let r=0;r<e.w;r++){const n=a(e,r,l);n&&(i.fillStyle=n,i.fillRect(r,l,1,1))}return t}function m(e){o(e);const t=e.pixels.map(i=>"    "+JSON.stringify(i)).join(`,
`);return`{
  "name": ${JSON.stringify(e.name)},
  "w": ${e.w},
  "h": ${e.h},
  "palette": ${JSON.stringify(e.palette)},
  "pixels": [
${t}
  ]
}
`}export{u as a,x as b,p as e,a as g,w as m,m as s};

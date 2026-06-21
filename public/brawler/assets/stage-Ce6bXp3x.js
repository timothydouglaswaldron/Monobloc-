const i={EMPTY:".",SOLID:"#",ONEWAY:"=",SPAWN:"S"};function S(e,s,l=20,t="untitled"){const o=Array.from({length:s},()=>i.EMPTY.repeat(e));return{name:t,cols:e,rows:s,cell:l,tiles:o}}function h(e,s,l){return l<0||l>=e.rows||s<0||s>=e.cols?i.EMPTY:e.tiles[l][s]||i.EMPTY}function T(e,s,l,t){if(l<0||l>=e.rows||s<0||s>=e.cols)return;const o=e.tiles[l];o[s]!==t&&(e.tiles[l]=o.slice(0,s)+t+o.slice(s+1))}function d(e){return{w:e.cols*e.cell,h:e.rows*e.cell}}function E(e){const s=[],l=e.cell;for(let t=0;t<e.rows;t++){const o=e.tiles[t];let n=0;for(;n<e.cols;){const c=o[n];if(c===i.SOLID||c===i.ONEWAY){let r=n;for(;r<e.cols&&o[r]===c;)r++;const u=n*l,f=(r-n)*l,w=t*l;c===i.SOLID?s.push({x:u,y:w,w:f,h:l,solid:!0}):s.push({x:u,y:w,w:f,h:8,solid:!1}),n=r}else n++}}return s}function O(e){const s=e.cell,l=[];for(let t=0;t<e.rows;t++)for(let o=0;o<e.cols;o++)e.tiles[t][o]===i.SPAWN&&l.push({x:o*s+s/2,y:t*s+s});return l}function y(e){const s=e.tiles.map(l=>"    "+JSON.stringify(l)).join(`,
`);return`{
  "name": ${JSON.stringify(e.name)},
  "cols": ${e.cols},
  "rows": ${e.rows},
  "cell": ${e.cell},
  "tiles": [
${s}
  ]
}
`}export{i as T,T as a,E as b,S as e,O as f,h as g,y as s,d as w};

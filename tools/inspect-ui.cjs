const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../app/src/main/assets/fhcpeweb.html'),'utf8');
const re = new RegExp(process.argv[2], 'g');
let m, count=0;
while((m=re.exec(html))&&count++<100) console.log(html.slice(Math.max(0,m.index-100),m.index+Number(process.argv[3]||900))+'\n');

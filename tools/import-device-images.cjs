// Merge local, user-supplied cutouts into the existing offline device gallery.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const target=path.resolve(__dirname,'../app/src/main/assets/upstream_images.js');
const context={window:{}};vm.runInNewContext(fs.readFileSync(target,'utf8'),context);
const images=context.window.__DEV_IMG__;
images.air6='data:image/webp;base64,'+fs.readFileSync(path.join(__dirname,'device-images/air6.webp')).toString('base64');
fs.writeFileSync(target,'/* Offline upstream and user-provided device images. */\nwindow.__DEV_IMG__='+JSON.stringify(images)+';\n');
console.log('Embedded Air6 cutout; '+Object.keys(images).length+' device images.');

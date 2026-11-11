'use strict';
// Serve unchanged application files at both root and a GitHub-style project path.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{verifyMenuBackground}=require('../scripts/verify-menu-background.cjs');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||'work/menu-background'),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.ogg':'audio/ogg','.m4a':'audio/mp4'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');let relative=decodeURIComponent(url.pathname);if(relative.startsWith('/phigros/'))relative=relative.slice('/phigros'.length);
 const file=path.resolve(root,'.'+relative+(relative.endsWith('/')?'index.html':''));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);});
});
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{for(const prefix of ['','phigros/'])await verifyMenuBackground(`http://127.0.0.1:${server.address().port}/`+prefix,path.join(out,prefix?'project':'root'));}finally{server.close();}})().catch(error=>{console.error(error);process.exitCode=1;});

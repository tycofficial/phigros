/* No DOM work or audio work: this worker lives only for a chart load. */
'use strict';
importScripts('./chart-codec.js','./resource-transfer.js');
self.onmessage=async({data})=>{
  try{
    let input=data.bytes;
    if(data.url){
      const address=new URL(data.url,self.location.href);
      if(address.origin!==self.location.origin||!/^https?:$/.test(address.protocol))throw Error('谱面必须来自本站');
      const raw=await PhiTransfer.download(address.href,{priority:'high',
        onProgress:(received,total)=>self.postMessage({type:'progress',stage:'download',received,total})});
      const start=Number(data.offset)||0,end=Number.isFinite(data.length)?start+data.length:raw.length;
      if(start<0||end>raw.length||end<start)throw Error('谱面资源不完整');
      input=raw.subarray(start,end);
      self.postMessage({type:'progress',stage:'decode',received:raw.length,total:raw.length});
    }
    importScripts('./vendor/lzma.js');
    const bytes=await new Promise((resolve,reject)=>LZMA.decompress(input,(result,error)=>{
      if(error)return reject(error);
      resolve(typeof result==='string'?new TextEncoder().encode(result):Uint8Array.from(result));
    }));
    if(bytes.length!==data.expectedSize)throw Error('内置谱面解压长度不一致');
    const packed=bytes[0]===80&&bytes[1]===57&&bytes[2]===67&&bytes[3]===49;
    const output=packed?new TextEncoder().encode(JSON.stringify(PhiChartCodec.decodePacked(bytes))):bytes;
    self.postMessage({ok:true,bytes:output},[output.buffer]);
  }catch(error){self.postMessage({ok:false,error:error?.message||String(error)});}
};

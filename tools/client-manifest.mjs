import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sourceRevision=process.env.HOF_SOURCE_REVISION;
if(!/^[0-9a-f]{40}$/.test(sourceRevision??''))throw Error('Full checked client revision required');
const files=[];
async function visit(directory=''){
 for(const item of await readdir('dist/'+directory,{withFileTypes:true})){
  const path=directory+item.name;
  if(item.isDirectory())await visit(path+'/');
  else if(item.isFile()&&path!=='client-manifest.json'){
   const bytes=await readFile('dist/'+path);files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }else if(!item.isFile())throw Error('Unexpected release file');
 }
}
await visit();files.sort((a,b)=>a.path.localeCompare(b.path));
await writeFile('dist/client-manifest.json',JSON.stringify({sourceRevision,files},null,2)+'\n');

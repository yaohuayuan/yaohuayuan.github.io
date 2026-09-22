export type Cell = { value: string | number; state?: 'active' | 'done' | 'muted' };
export type Frame = { cells: Cell[]; message: string; detail?: string };
export const searchValues = [2, 5, 8, 12, 16, 23, 31, 42, 56, 64, 78, 91];
export function binaryFrames(target: number): Frame[] {
  let lo = 0, hi = searchValues.length - 1;
  const frames: Frame[] = [{ cells: searchValues.map(value=>({ value })), message: '有序数组就绪。选择目标，逐步缩小闭区间 [left, right]。' }];
  while (lo <= hi) {
    const mid = Math.floor((lo+hi)/2);
    frames.push({ cells: searchValues.map((value,i)=>({ value, state: i===mid ? 'active' : i<lo||i>hi ? 'muted' : undefined })), message: `left = ${lo} · mid = ${mid} · right = ${hi}，比较 ${searchValues[mid]} 与 ${target}。` });
    if (searchValues[mid] === target) { frames.push({ cells:searchValues.map((value,i)=>({value,state:i===mid?'done':'muted'})), message:`找到目标 ${target}，下标为 ${mid}。` }); return frames; }
    if (searchValues[mid] < target) lo = mid+1; else hi = mid-1;
  }
  frames.push({ cells:searchValues.map(value=>({value,state:'muted'})),message:`区间为空，数组中不存在 ${target}。` }); return frames;
}
export function sortingFrames(input = [42, 16, 64, 8, 31, 56, 12, 78]): Frame[] {
  const values = [...input]; const frames: Frame[] = [{cells:values.map(value=>({value})),message:'冒泡排序：比较相邻元素，将较大的值移向右侧。'}];
  for (let end=values.length-1;end>0;end--) {
    let swapped=false;
    for(let i=0;i<end;i++) {
      frames.push({cells:values.map((value,j)=>({value,state:j>end?'done':j===i||j===i+1?'active':undefined})),message:`比较下标 ${i} 与 ${i+1}：${values[i]} 和 ${values[i+1]}。`});
      if(values[i]>values[i+1]) { [values[i],values[i+1]]=[values[i+1],values[i]]; swapped=true; frames.push({cells:values.map((value,j)=>({value,state:j>end?'done':j===i||j===i+1?'active':undefined})),message:'前者更大，交换相邻元素。'}); }
    }
    if(!swapped) break;
  }
  frames.push({cells:values.map(value=>({value,state:'done'})),message:'排序完成。最坏时间复杂度 O(n²)，额外空间 O(1)（不含演示快照）。'});return frames;
}
export const graph: number[][] = [[1,2],[0,3,4],[0,5],[1],[1,5],[2,4]];
export function bfsFrames(start=0): Frame[] {
  const queue=[start],seen=new Set([start]),visited:number[]=[]; const distance=Array(6).fill(-1);distance[start]=0;
  const frames:Frame[]=[{cells:graph.map((_,i)=>({value:String.fromCharCode(65+i)})),message:'图的边：A–B、A–C、B–D、B–E、C–F、E–F。队列从 A 开始。',detail:'队列: A'}];
  while(queue.length) {
    const node=queue.shift()!;visited.push(node);
    for(const neighbor of graph[node]) if(!seen.has(neighbor)){seen.add(neighbor);queue.push(neighbor);distance[neighbor]=distance[node]+1;}
    frames.push({cells:graph.map((_,i)=>({value:String.fromCharCode(65+i),state:i===node?'active':visited.includes(i)?'done':queue.includes(i)?undefined:'muted'})),message:`访问 ${String.fromCharCode(65+node)}，距起点 ${distance[node]} 条边；将尚未发现的邻居入队。`,detail:`队列: ${queue.map(i=>String.fromCharCode(65+i)).join(' → ')||'空'} · 已访问: ${visited.map(i=>String.fromCharCode(65+i)).join(' → ')}`});
  }
  frames.push({cells:graph.map((_,i)=>({value:String.fromCharCode(65+i),state:'done'})),message:'遍历完成。同一节点只入队一次，得到无权图从起点出发的最短距离。',detail:'距离: A=0 · B=1 · C=1 · D=2 · E=2 · F=2'});return frames;
}
export const pageRequests=[1,2,3,1,4,2,5,1,2,3,4,5];
export function bufferFrames(capacity=3):Frame[] {
  if(!Number.isInteger(capacity)||capacity<1) throw new RangeError('Capacity must be positive');
  const cache:number[]=[];let hits=0;
  const cells=()=>Array.from({length:capacity},(_,i)=>({value:cache[i]??'—'}));
  const frames:Frame[]=[{cells:cells(),message:`空缓冲池，容量 ${capacity} 页。左侧为最近访问，右侧为最久未访问。`,detail:'命中 0 / 0'}];
  pageRequests.forEach((page,index)=>{
    const pos=cache.indexOf(page);const hit=pos>=0;let evicted:number|undefined;
    if(hit){hits++;cache.splice(pos,1);}else if(cache.length===capacity){evicted=cache.pop();}
    cache.unshift(page);
    frames.push({cells:cells().map((cell,i)=>({...cell,state:i===0?'active':undefined})),message:`访问页 ${page}：${hit?'命中，移到最近访问端':evicted===undefined?'缺页，加载到空闲帧':`缺页，淘汰页 ${evicted} 并加载`}。`,detail:`命中 ${hits} / ${index+1} · 命中率 ${Math.round(hits/(index+1)*100)}% · ${pageRequests.slice(0,index+1).join(' → ')}`});
  });return frames;
}
export const treeLeaves=[[2,5,8],[12,16,23],[31,42,56],[64,78,91]];
export function treeFrames(target:number):Frame[]{
  const separators=treeLeaves.slice(1).map(leaf=>leaf[0]);let leafIndex=0;while(leafIndex<separators.length&&target>=separators[leafIndex]) leafIndex++;
  return [
    {cells:separators.map(value=>({value})),message:'根节点分隔键为 12、31、64。相等时走右侧分支；记录键全部保留在叶节点。'},
    {cells:treeLeaves.map((leaf,i)=>({value:leaf.join(' · '),state:i===leafIndex?'active':'muted'})),message:`目标 ${target} 落在第 ${leafIndex+1} 个叶节点。叶节点由左至右有序相连。`},
    {cells:treeLeaves[leafIndex].map(value=>({value,state:value===target?'done':'muted'})),message:treeLeaves[leafIndex].includes(target)?`在叶节点找到键 ${target}。`:`叶节点中没有键 ${target}，查找结束。`}
  ];
}
export function growthValues(rate:number,capacity=100,initial=5) { return Array.from({length:101},(_,i)=>{const t=i/10;return {t,logistic:capacity/(1+(capacity/initial-1)*Math.exp(-rate*t)),exponential:initial*Math.exp(rate*t)};}); }

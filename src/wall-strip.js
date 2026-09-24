// One footprint per connected line. Closed lines become a ring with a hole,
// rather than a set of cylinders and overlapping segment polygons.
export function wallStrip(path, width, alignment = 'center') {
  if (!Array.isArray(path) || path.length < 2 || !Number.isFinite(width) || width <= 0) return null;
  if (path.some(p => !Array.isArray(p) || !Number.isFinite(Number(p[0])) || !Number.isFinite(Number(p[1])) || Math.abs(p[0])>180 || Math.abs(p[1])>=90)) return null;
  const origin = path[0], sx = 111320*Math.cos(origin[1]*Math.PI/180), sy=110574;
  const points=[];
  for(const p of path){const q=[(p[0]-origin[0])*sx,(p[1]-origin[1])*sy];if(!points.length || Math.hypot(q[0]-points.at(-1)[0],q[1]-points.at(-1)[1])>1e-6) points.push(q);}
  if(points.length<2)return null;
  const closed=Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<1e-6;
  if(closed)points.pop();
  if(points.length<(closed?3:2))return null;
  const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
  const area=ring=>ring.reduce((sum,p,i)=>sum+cross(p,ring[(i+1)%ring.length]),0)/2;
  if(alignment==='inside')alignment=area(points)>0?'left':'right';
  if(alignment==='outside')alignment=area(points)>0?'right':'left';
  const left=alignment==='right'?0:alignment==='left'?width:width/2;
  const right=alignment==='left'?0:alignment==='right'?-width:-width/2;
  const segments=points.slice(0,closed?points.length:-1).map((p,i)=>{const q=points[(i+1)%points.length],length=Math.hypot(q[0]-p[0],q[1]-p[1]);return [(q[0]-p[0])/length,(q[1]-p[1])/length];});
  function offset(distance){return points.flatMap((p,i)=>{
    const prev=segments[(i-1+segments.length)%segments.length],next=segments[i%segments.length];
    const shift=d=>[p[0]-d[1]*distance,p[1]+d[0]*distance];
    if(!closed&&i===0)return [shift(next)];
    if(!closed&&i===points.length-1)return [shift(prev)];
    const a=shift(prev),b=shift(next),den=cross(prev,next);
    if(Math.abs(den)<1e-10)return [b];
    const t=cross([b[0]-a[0],b[1]-a[1]],next)/den;
    const join=[a[0]+t*prev[0],a[1]+t*prev[1]];
    return Math.hypot(join[0]-p[0],join[1]-p[1])<=Math.max(width*4,.001)?[join]:[a,b];
  });}
  let rings;
  const a=offset(left),b=offset(right);
  if(closed){rings=Math.abs(area(a))>Math.abs(area(b))?[a,b]:[b,a];}
  else rings=[[...a,...b.reverse()]];
  rings=rings.map((ring,i)=>{if((area(ring)>0)!==(i===0))ring.reverse();const result=ring.map(p=>[Number(origin[0])+p[0]/sx,Number(origin[1])+p[1]/sy]);result.push([...result[0]]);return result;});
  return {type:'Polygon',coordinates:rings};
}

// Realistic heavy shaders for the compile / GPU-timing checks.
// Families mirror the planned scenes: KIFS facade city (S3), gyroid/Schwarz-P TPMS (S2),
// Indra's pearls / Kleinian sphere-inversion folding with mirror bounces (S7), and an "uber" shader
// that contains all three behind a uniform switch plus volumetrics.

export type Family = 'kifs' | 'tpms' | 'indra' | 'uber';
export const FAMILIES: Family[] = ['kifs', 'tpms', 'indra', 'uber'];

export interface Quality {
  STEPS: number;
  SHADOW_STEPS: number;
  AO_STEPS: number;
  KIFS_IT: number;
  IND_IT: number;
  BOUNCES: number;
  REFL: number;
  VOL_STEPS: number;
}
export const QUALITY: Quality[] = [
  { STEPS: 100, SHADOW_STEPS: 24, AO_STEPS: 4, KIFS_IT: 4, IND_IT: 6, BOUNCES: 1, REFL: 0, VOL_STEPS: 12 },
  { STEPS: 140, SHADOW_STEPS: 32, AO_STEPS: 5, KIFS_IT: 5, IND_IT: 7, BOUNCES: 2, REFL: 0, VOL_STEPS: 16 },
  { STEPS: 180, SHADOW_STEPS: 48, AO_STEPS: 5, KIFS_IT: 6, IND_IT: 8, BOUNCES: 3, REFL: 1, VOL_STEPS: 24 },
  { STEPS: 220, SHADOW_STEPS: 64, AO_STEPS: 6, KIFS_IT: 7, IND_IT: 9, BOUNCES: 4, REFL: 1, VOL_STEPS: 32 },
];

function header(q: Quality, n: number, extra = ''): string {
  return `#version 300 es
precision highp float;
precision highp int;
#define STEPS ${q.STEPS}
#define SHADOW_STEPS ${q.SHADOW_STEPS}
#define AO_STEPS ${q.AO_STEPS}
#define KIFS_IT ${q.KIFS_IT}
#define IND_IT ${q.IND_IT}
#define BOUNCES ${q.BOUNCES}
#define REFL ${q.REFL}
#define VOL_STEPS ${q.VOL_STEPS}
#define NONCE ${n.toFixed(9)}
${extra}
uniform vec2 uRes;
uniform float uTime;
uniform int uScene;
out vec4 o;
`;
}

const LIB = /* glsl */ `
#define PI 3.14159265359
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
float hash12(vec2 p){vec3 p3=fract(p.xyx*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float hash13(vec3 p3){p3=fract(p3*.1031);p3+=dot(p3,p3.zyx+31.32);return fract((p3.x+p3.y)*p3.z);}
float vnoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  float a=hash13(i),b=hash13(i+vec3(1,0,0)),c=hash13(i+vec3(0,1,0)),d=hash13(i+vec3(1,1,0));
  float e=hash13(i+vec3(0,0,1)),g=hash13(i+vec3(1,0,1)),h=hash13(i+vec3(0,1,1)),k=hash13(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,k,f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vnoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}
float sdBox(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
vec3 pal(float t,vec3 a,vec3 b,vec3 c,vec3 d){return a+b*cos(6.28318*(c*t+d));}
vec3 lin(vec3 c){return pow(c,vec3(2.2));}
mat3 camLook(vec3 ro,vec3 ta,float roll){vec3 f=normalize(ta-ro);vec3 r=normalize(cross(f,vec3(sin(roll),cos(roll),0.)));vec3 u=cross(r,f);return mat3(r,u,f);}
`;

const MAP_CITY = /* glsl */ `
float kifsOrn(vec3 p){
  float s=1.;
  for(int i=0;i<KIFS_IT;i++){
    p=abs(p);
    if(p.x<p.y)p.xy=p.yx;
    if(p.x<p.z)p.xz=p.zx;
    if(p.y<p.z)p.yz=p.zy;
    p.xy*=rot(.32);
    p.xz*=rot(-.21);
    p=p*1.85-vec3(1.2,.75,.45);
    s*=1.85;
  }
  return sdBox(p,vec3(.55,.35,.25))/s;
}
vec2 mapCity(vec3 p){
  const float CELL=12.;
  vec2 id=floor(p.xz/CELL);
  vec3 q=p; q.xz=mod(q.xz,CELL)-.5*CELL;
  float h=9.+18.*hash12(id);
  vec3 bc=q-vec3(0.,h*.5,0.);
  float body=sdBox(bc,vec3(3.6,h*.5,3.6));
  // recessed windows (domain repetition), only within .22 of the facade
  float wy=mod(q.y,1.8)-.9;
  vec2 wxz=mod(q.xz+.6,1.2)-.6;
  float win=min(sdBox(vec3(wxz.x,wy,q.z),vec3(.34,.55,9.)),sdBox(vec3(q.x,wy,wxz.y),vec3(9.,.55,.34)));
  win=max(win,-(body+.22));
  win=max(win,1.5-q.y);
  body=max(body,-win);
  // ornamental KIFS relief bands on the facades
  float ax=abs(q.x),az=abs(q.z);
  vec3 fr=vec3(ax>az?q.z:q.x, mod(q.y,4.5)-2.25, max(ax,az)-3.6);
  float relief=max(kifsOrn(fr*1.6)/1.6, sdBox(fr,vec3(3.4,.6,.3)));
  relief=max(relief,q.y-h+.3);
  // KIFS cornice
  vec3 cc=q-vec3(0.,h+.5,0.);
  float corn=max(kifsOrn(cc*.85)/.85, sdBox(cc,vec3(4.,.9,4.)));
  float orn=min(relief,corn);
  float d=min(body,orn);
  float m=orn<body?2.:1.;
  if(p.y<d){d=p.y;m=0.;}
  return vec2(d,m);
}
`;

const MAP_TPMS = /* glsl */ `
float gyroid(vec3 p){return dot(sin(p),cos(p.yzx));}
float schwarzP(vec3 p){return cos(p.x)+cos(p.y)+cos(p.z);}
vec2 mapTPMS(vec3 p){
  const float SC=1.5;
  vec3 q=p*SC;
  float mo=.5+.5*sin(uTime*.21);
  float f=mix(gyroid(q),schwarzP(q),mo);
  float d=(abs(f)-.22)/(SC*1.9);
  d+=.012*gyroid(q*4.1+vec3(0.,uTime*.3,0.));
  float d2=(abs(gyroid(q*2.+1.57))-.06)/(SC*2.*1.9);
  d2=max(d2,(.5-abs(f))/(SC*1.9));
  float m=1.;
  if(d2<d){d=d2;m=2.;}
  return vec2(d,m);
}
`;

const MAP_INDRA = /* glsl */ `
// Kleinian / Apollonian limit set: translate-fold into the fundamental domain + sphere inversion (Jos Leys style)
vec2 mapIndra(vec3 p){
  vec3 z=p; float s=1.; float trap=1e9;
  for(int i=0;i<IND_IT;i++){
    z=-1.+2.*fract(.5*z+.5);
    float r2=dot(z,z);
    trap=min(trap,r2);
    float k=1.18/max(r2,1e-5);
    z*=k; s*=k;
  }
  float d=.25*abs(z.y)/s;
  // mirrored pearls on the lattice of the group
  vec3 c=mod(p,2.)-1.;
  float pearl=length(c)-.36;
  if(pearl<d) return vec2(pearl,1.);
  return vec2(d,2.+clamp(trap,0.,.99));
}
`;

const RM = /* glsl */ `
vec3 calcNormal(vec3 p,float t){
  vec2 e=vec2(1.,-1.)*.5773*max(.0004,.0004*t);
  return normalize(e.xyy*map(p+e.xyy).x+e.yyx*map(p+e.yyx).x+e.yxy*map(p+e.yxy).x+e.xxx*map(p+e.xxx).x);
}
float softShadow(vec3 ro,vec3 rd,float tmax){
  float res=1.,t=.02;
  for(int i=0;i<SHADOW_STEPS;i++){
    float h=map(ro+rd*t).x;
    res=min(res,10.*h/t);
    t+=clamp(h,.02,.6);
    if(res<.001||t>tmax)break;
  }
  return clamp(res,0.,1.);
}
float calcAO(vec3 p,vec3 n){
  float occ=0.,sca=1.;
  for(int i=0;i<AO_STEPS;i++){
    float hr=.01+.12*float(i)/float(AO_STEPS-1);
    float d=map(p+n*hr).x;
    occ+=(hr-d)*sca; sca*=.9;
  }
  return clamp(1.-3.*occ,0.,1.);
}
vec2 march(vec3 ro,vec3 rd,float tmax,float k){
  float t=0.,m=-1.;
  for(int i=0;i<STEPS;i++){
    vec2 h=map(ro+rd*t);
    if(abs(h.x)<.0004*t+.0002){m=h.y;break;}
    t+=h.x*k;
    if(t>tmax)break;
  }
  return vec2(t,m);
}
`;

const SCENE_CITY = /* glsl */ `
vec3 sceneCity(vec2 uv){
  float t=uTime;
  vec3 ro=vec3(6.+t*4.,24.+3.*sin(t*.3),t*6.);
  vec3 ta=ro+vec3(sin(t*.2)*8.,-7.,14.);
  mat3 cam=camLook(ro,ta,.05*sin(t*.4));
  vec3 rd=cam*normalize(vec3(uv,1.6));
  vec3 sky=lin(vec3(250.,202.,222.)/255.);
  vec3 L=normalize(vec3(.55,.6,.35));
  vec2 h=march(ro,rd,160.,.7);
  vec3 col=sky*(1.15-.5*max(rd.y,0.))+vec3(1.,.8,.6)*pow(max(dot(rd,L),0.),32.)*2.;
  if(h.y>-.5){
    vec3 p=ro+rd*h.x,n=calcNormal(p,h.x);
    float sh=softShadow(p+n*.02,L,30.);
    float ao=calcAO(p,n);
    vec3 alb=h.y<.5?vec3(.18,.16,.2)*(.7+.3*hash12(floor(p.xz*.5))):h.y<1.5?lin(vec3(222.,202.,222.)/255.)*.75:vec3(.85,.62,.42);
    float dif=max(dot(n,L),0.)*sh;
    float bou=clamp(.5+.5*n.y,0.,1.)*ao;
    vec3 lig=dif*vec3(3.,2.6,2.2)+bou*sky*.6+ao*vec3(.08,.07,.1)*(1.-n.y);
    col=alb*lig;
    col=mix(col,sky,1.-exp(-1.5e-5*h.x*h.x));
  }
  return col;
}
`;

const SCENE_TPMS = /* glsl */ `
vec3 sceneTPMS(vec2 uv){
  float t=uTime;
  vec3 ro=vec3(1.05,0.,t*.35);
  vec3 ta=ro+vec3(.2*sin(t*.3),.15*cos(t*.23),1.);
  mat3 cam=camLook(ro,ta,t*.05);
  vec3 rd=cam*normalize(vec3(uv,1.2));
  vec2 h=march(ro,rd,24.,.6);
  vec3 fogc=vec3(.02,.015,.03);
  vec3 col=fogc;
  if(h.y>-.5){
    vec3 p=ro+rd*h.x,n=calcNormal(p,h.x);
    vec3 lp=ro+vec3(.3*sin(t),.3*cos(t*.7),1.5);
    vec3 ld=lp-p; float ll=length(ld); ld/=ll;
    float sh=softShadow(p+n*.004,ld,ll);
    float ao=calcAO(p,n);
    float fre=pow(1.-max(dot(-rd,n),0.),3.);
    vec3 alb=h.y<1.5?pal(dot(n,rd)*.5+p.z*.05,vec3(.5),vec3(.45),vec3(1.),vec3(0.,.33,.67)):lin(vec3(190.,173.,237.)/255.);
    float dif=max(dot(n,ld),0.)*sh/(1.+ll*ll*.3);
    col=alb*(dif*vec3(6.,5.,4.5)+ao*.05)+fre*ao*vec3(.4,.3,.6)*.4;
#if REFL
    vec3 rr=reflect(rd,n);
    vec2 h2=march(p+n*.004,rr,8.,.6);
    if(h2.y>-.5){vec3 p2=p+n*.004+rr*h2.x;vec3 n2=calcNormal(p2,h2.x);col+=fre*.5*pal(p2.z*.1,vec3(.5),vec3(.5),vec3(1.),vec3(0.,.33,.67))*max(dot(n2,normalize(lp-p2)),0.);}
#endif
    col=mix(col,fogc,1.-exp(-.08*h.x*h.x));
  }
  return col;
}
`;

const SCENE_INDRA = /* glsl */ `
vec3 envIndra(vec3 rd){
  vec3 e=lin(vec3(222.,202.,222.)/255.)*(.15+.6*max(rd.y,0.));
  // the glowing screen (and its viewer) behind the camera
  if(rd.z<-.85&&abs(rd.x)<.35&&abs(rd.y)<.22) e+=(abs(rd.x)<.06&&rd.y<.05)?vec3(.0):vec3(5.);
  return e;
}
vec3 sceneIndra(vec2 uv){
  float t=uTime;
  vec3 ro=vec3(1.+.55*cos(t*.2),1.+.25*sin(t*.17),1.+.55*sin(t*.2));
  vec3 ta=vec3(1.,1.,1.)+vec3(.2*sin(t*.3),0.,.2*cos(t*.3));
  mat3 cam=camLook(ro,ta,0.);
  vec3 rd=cam*normalize(vec3(uv,1.4));
  vec3 acc=vec3(0.),thr=vec3(1.);
  vec3 L=normalize(vec3(.4,.8,-.3));
  for(int b=0;b<BOUNCES;b++){
    vec2 h=march(ro,rd,12.,1.);
    if(h.y<-.5){acc+=thr*envIndra(rd);break;}
    vec3 p=ro+rd*h.x,n=calcNormal(p,h.x);
    if(h.y<1.5){
      float fre=.04+.96*pow(1.-max(dot(-rd,n),0.),5.);
      vec3 tint=lin(vec3(190.,173.,237.)/255.);
      acc+=thr*tint*.04*calcAO(p,n);
      thr*=mix(tint*.85,vec3(1.),fre);
      ro=p+n*.003; rd=reflect(rd,n);
    }else{
      float trap=h.y-2.;
      vec3 alb=pal(sqrt(trap)*.8,vec3(.5),vec3(.5),vec3(1.),vec3(0.,.1,.2));
      float sh=softShadow(p+n*.002,L,6.);
      float ao=calcAO(p,n);
      acc+=thr*alb*(sh*max(dot(n,L),0.)*1.8+ao*.25);
      break;
    }
  }
  return acc;
}
`;

const VOLUME = /* glsl */ `
// volumetric light shafts through fbm fog, sampling the scene SDF for occlusion
vec3 volumetric(vec3 ro,vec3 rd,float tmax,vec3 L,vec3 lc){
  vec3 acc=vec3(0.); float tr=1.;
  float dt=min(tmax,40.)/float(VOL_STEPS);
  float t=dt*hash12(gl_FragCoord.xy+NONCE);
  for(int i=0;i<VOL_STEPS;i++){
    vec3 p=ro+rd*t;
    float den=.04*fbm(p*.15+vec3(0.,uTime*.1,0.));
    float occ=clamp(map(p+L*1.5).x*.7,0.,1.);
    acc+=tr*den*occ*lc*dt;
    tr*=exp(-den*dt);
    t+=dt;
  }
  return acc;
}
`;

const MAIN_SINGLE = (fn: string) => /* glsl */ `
void main(){
  vec2 uv=(2.*gl_FragCoord.xy-uRes)/uRes.y;
  vec3 col=${fn}(uv);
  o=vec4(col+NONCE*1e-7,1.);
}
`;

const MAIN_UBER = /* glsl */ `
vec2 map(vec3 p){
  if(uScene==0) return mapCity(p);
  if(uScene==1) return mapTPMS(p);
  return mapIndra(p);
}
${RM}
${SCENE_CITY}
${SCENE_TPMS}
${SCENE_INDRA}
${VOLUME}
void main(){
  vec2 uv=(2.*gl_FragCoord.xy-uRes)/uRes.y;
  vec3 col;
  if(uScene==0) col=sceneCity(uv);
  else if(uScene==1) col=sceneTPMS(uv);
  else col=sceneIndra(uv);
  vec3 ro=vec3(0.,2.,uTime);
  vec3 rd=normalize(vec3(uv,1.5));
  col+=volumetric(ro,rd,30.,normalize(vec3(.5,.7,.2)),vec3(1.,.85,.9));
  // grain + vignette
  col*=1.-.25*dot(uv,uv)*.25;
  col+=(hash12(gl_FragCoord.xy+fract(uTime))-.5)*.01;
  o=vec4(col+NONCE*1e-7,1.);
}
`;

export function raymarchFS(family: Family, qi: number, n: number): string {
  const q = QUALITY[qi];
  const h = header(q, n);
  switch (family) {
    case 'kifs':
      return h + LIB + MAP_CITY + 'vec2 map(vec3 p){return mapCity(p);}\n' + RM + SCENE_CITY + MAIN_SINGLE('sceneCity');
    case 'tpms':
      return h + LIB + MAP_TPMS + 'vec2 map(vec3 p){return mapTPMS(p);}\n' + RM + SCENE_TPMS + MAIN_SINGLE('sceneTPMS');
    case 'indra':
      return h + LIB + MAP_INDRA + 'vec2 map(vec3 p){return mapIndra(p);}\n' + RM + SCENE_INDRA + MAIN_SINGLE('sceneIndra');
    case 'uber':
      return h + LIB + MAP_CITY + MAP_TPMS + MAP_INDRA + MAIN_UBER;
  }
}

/** Good-looking fixed times per family for the timing checks. */
export const FAMILY_TIME: Record<Family, number> = { kifs: 7.0, tpms: 8.0, indra: 2.0, uber: 7.0 };

// ---------------------------------------------------------------------------------------------
// Post: bloom (13-tap downsample, tent upsample) + AgX

export const HDR_PATTERN_FS = `#version 300 es
precision highp float;
uniform vec2 uRes; out vec4 o;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 c=vec3(.05,.04,.06)+vec3(.3,.2,.25)*uv.y;
  vec2 g=floor(uv*vec2(24.,14.));
  vec2 f=fract(uv*vec2(24.,14.))-.5;
  float r=h(g);
  if(r>.8) c+=vec3(40.,25.,30.)*exp(-dot(f,f)*120.)*r;
  c+=vec3(2.,1.6,1.2)*smoothstep(.01,.0,abs(uv.y-.5-.1*sin(uv.x*12.)));
  o=vec4(c,1.);
}`;

export const BLOOM_DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uDst; uniform int uKaris;
out vec4 o;
vec3 s(vec2 uv){return texture(uSrc,uv).rgb;}
float kw(vec3 c){return 1./(1.+dot(c,vec3(.2126,.7152,.0722)));}
void main(){
  vec2 uv=gl_FragCoord.xy/uDst; vec2 t=uTexel;
  vec3 a=s(uv+t*vec2(-2,2)),b=s(uv+t*vec2(0,2)),c=s(uv+t*vec2(2,2));
  vec3 d=s(uv+t*vec2(-2,0)),e=s(uv),f=s(uv+t*vec2(2,0));
  vec3 g=s(uv+t*vec2(-2,-2)),h=s(uv+t*vec2(0,-2)),i=s(uv+t*vec2(2,-2));
  vec3 j=s(uv+t*vec2(-1,1)),k=s(uv+t*vec2(1,1)),l=s(uv+t*vec2(-1,-1)),m=s(uv+t*vec2(1,-1));
  vec3 r;
  if(uKaris==1){
    vec3 g0=(a+b+d+e)*.25,g1=(b+c+e+f)*.25,g2=(d+e+g+h)*.25,g3=(e+f+h+i)*.25,g4=(j+k+l+m)*.25;
    float w0=kw(g0),w1=kw(g1),w2=kw(g2),w3=kw(g3),w4=kw(g4);
    r=(g0*w0*.125+g1*w1*.125+g2*w2*.125+g3*w3*.125+g4*w4*.5)/(w0*.125+w1*.125+w2*.125+w3*.125+w4*.5);
  } else {
    r=e*.125+(a+c+g+i)*.03125+(b+d+f+h)*.0625+(j+k+l+m)*.125;
  }
  o=vec4(r,1.);
}`;

export const BLOOM_UP_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uDst; uniform float uRadius;
out vec4 o;
vec3 s(vec2 uv){return texture(uSrc,uv).rgb;}
void main(){
  vec2 uv=gl_FragCoord.xy/uDst; vec2 t=uTexel*uRadius;
  vec3 r=s(uv+t*vec2(-1,1))+2.*s(uv+t*vec2(0,1))+s(uv+t*vec2(1,1))
        +2.*s(uv+t*vec2(-1,0))+4.*s(uv)+2.*s(uv+t*vec2(1,0))
        +s(uv+t*vec2(-1,-1))+2.*s(uv+t*vec2(0,-1))+s(uv+t*vec2(1,-1));
  o=vec4(r/16.,1.);
}`;

export const AGX_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene; uniform sampler2D uBloom; uniform vec2 uDst; uniform float uBloomAmt; uniform float uExposure;
out vec4 o;
vec3 agxContrast(vec3 x){vec3 x2=x*x,x4=x2*x2;return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+.4298*x2+.1191*x-.00232;}
vec3 agx(vec3 v){
  const mat3 m=mat3(.842479062253094,.0423282422610123,.0423756549057051,.0784335999999992,.878468636469772,.0784336,.0792237451477643,.0791661274605434,.879142973793104);
  const float mn=-12.47393,mx=4.026069;
  v=m*v; v=clamp(log2(max(v,1e-10)),mn,mx); v=(v-mn)/(mx-mn);
  return agxContrast(v);
}
vec3 agxEotf(vec3 v){
  const mat3 mi=mat3(1.19687900512017,-.0528968517574562,-.0529716355144438,-.0980208811401368,1.15190312990417,-.0980434501171241,-.0990297440797205,-.0989611768448433,1.15107367264116);
  return pow(max(mi*v,0.),vec3(2.2));
}
vec3 oetf(vec3 c){return mix(12.92*c,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
void main(){
  vec2 uv=gl_FragCoord.xy/uDst;
  vec3 c=texture(uScene,uv).rgb+uBloomAmt*texture(uBloom,uv).rgb;
  c=agxEotf(agx(c*uExposure));
  c=oetf(clamp(c,0.,1.))+(ign(gl_FragCoord.xy)-.5)/255.;
  o=vec4(c,1.);
}`;

// ---------------------------------------------------------------------------------------------
// Particles: Thomas attractor, RK4

export const THOMAS_B = 0.208186;

export const PART_INIT_VS = `#version 300 es
out vec4 vPos;
uint hsh(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;}
float h01(uint x){return float(hsh(x))/4294967295.;}
void main(){
  uint i=uint(gl_VertexID);
  vPos=vec4(h01(i*3u)*6.-3.,h01(i*3u+1u)*6.-3.,h01(i*3u+2u)*6.-3.,h01(i^0x9e3779b9u));
  gl_Position=vec4(0.,0.,0.,1.);
}`;

const RK4 = `
uniform float uDt; uniform float uB;
vec3 f(vec3 p){return sin(p.yzx)-uB*p;}
vec3 rk4(vec3 p){
  float h=uDt;
  vec3 k1=f(p),k2=f(p+.5*h*k1),k3=f(p+.5*h*k2),k4=f(p+h*k3);
  return p+h/6.*(k1+2.*k2+2.*k3+k4);
}`;

const SPLAT_COMMON = `
uniform mat4 uMVP;
out vec3 vCol;
vec3 splatCol(vec3 p,float w){return mix(vec3(.9,.5,1.),vec3(.4,.8,1.),w)*.004;}
`;

/** TF update only (rasterizer discard). */
export const PART_UPDATE_VS = `#version 300 es
layout(location=0) in vec4 aPos;
out vec4 vPos;
${RK4}
void main(){ vPos=vec4(rk4(aPos.xyz),aPos.w); gl_Position=vec4(0.,0.,0.,1.); }`;

/** TF update + rasterize the updated point in the same pass (fused). */
export const PART_FUSED_VS = `#version 300 es
layout(location=0) in vec4 aPos;
out vec4 vPos;
${RK4}
${SPLAT_COMMON}
void main(){
  vec3 p=rk4(aPos.xyz);
  vPos=vec4(p,aPos.w);
  gl_Position=uMVP*vec4(p,1.); gl_PointSize=1.; vCol=splatCol(p,aPos.w);
}`;

/** Splat from a vertex buffer. */
export const PART_SPLAT_VS = `#version 300 es
layout(location=0) in vec4 aPos;
${SPLAT_COMMON}
void main(){ gl_Position=uMVP*vec4(aPos.xyz,1.); gl_PointSize=1.; vCol=splatCol(aPos.xyz,aPos.w); }`;

/** Vertex pulling: no buffers, state in an RGBA32F texture indexed by gl_VertexID. */
export const PART_PULL_VS = `#version 300 es
uniform highp sampler2D uState; uniform int uW;
${SPLAT_COMMON}
void main(){
  int i=gl_VertexID;
  vec4 s=texelFetch(uState,ivec2(i%uW,i/uW),0);
  gl_Position=uMVP*vec4(s.xyz,1.); gl_PointSize=1.; vCol=splatCol(s.xyz,s.w);
}`;

/** Texture-state update (fragment shader GPGPU). */
export const PART_TEX_UPDATE_FS = `#version 300 es
precision highp float;
uniform highp sampler2D uState;
out vec4 o;
${RK4}
void main(){ vec4 s=texelFetch(uState,ivec2(gl_FragCoord.xy),0); o=vec4(rk4(s.xyz),s.w); }`;

export const PART_TEX_INIT_FS = `#version 300 es
precision highp float;
out vec4 o;
uint hsh(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;}
float h01(uint x){return float(hsh(x))/4294967295.;}
void main(){
  uint i=uint(gl_FragCoord.y)*4096u+uint(gl_FragCoord.x);
  o=vec4(h01(i*3u)*6.-3.,h01(i*3u+1u)*6.-3.,h01(i*3u+2u)*6.-3.,h01(i^0x9e3779b9u));
}`;

export const PART_SPLAT_FS = `#version 300 es
precision highp float;
in vec3 vCol; out vec4 o;
void main(){ o=vec4(vCol,1.); }`;

export const NULL_FS = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o=vec4(0.); }`;

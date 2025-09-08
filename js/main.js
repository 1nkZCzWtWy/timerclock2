let N=5;
let started=false, startTime=null, startSec=0, startHour=null, startMin=null;
let audioUnlocked=false, jaVoice=null, audioCtx=null;

function ensureAudioCtx(){
  if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended' && typeof audioCtx.resume==='function'){
    audioCtx.resume().catch(()=>{});
  }
}

const $=id=>document.getElementById(id);
const clock=$('clock');
const ctx=clock.getContext('2d');
const range=$('range');
const nVal=$('nVal');
const nUnit=$('nUnit');
const soundIcon=$('soundIcon');
const gate=$('gate');
const gateBtn=$('gateBtn');
const nextBtn=$('nextBtn');
const resetBtn=$('resetBtn');
const actions=$('actions');
const preMsg=$('preMsg');

// Capture action area height once and expose via CSS variable
const ACTIONS_H = (()=>{
  if(!actions) return 0;
  const holder = actions.parentElement;
  const prevHolderH = holder.style.height;
  holder.style.height='auto';
  if(preMsg) preMsg.style.display='none';
  actions.style.display='flex';
  const h = actions.offsetHeight;
  actions.style.display='none';
  if(preMsg) preMsg.style.display='';
  holder.style.height=prevHolderH;
  document.documentElement.style.setProperty('--actions-h', h+'px');
  return h;
})();

// ====== 分針ドラッグ用の状態 ======
let dragging=false;       // ドラッグ中か
let dragMinIdx=null;      // ドラッグ中の分（0-59、目盛りにスナップ）
let timerLocked=false;    // 一度設定したらロック
let timerSet=false;       // タイマーが設定済みか
let endMinuteIdx=null;    // 終了分（0-59）
let timerSetTime=null;    // タイマー設定時刻
let timerStartAngle=null; // 開始角（設定時の現在分角）
let timerEndAngle=null;   // 終了角（endMinuteIdx に対応）
let endDate=null;         // 終了の実日時（mm:00）
let endAnnounced=false;   // 終了アナウンス済み
let overrunStart=null;    // 超過開始時刻

// N分アナウンスの秒0合わせスケジュール
let nNextAnnounce=null;   // 次のアナウンス時刻（mm:00）
let nFirstApprox=false;   // 初回のみ「だいたい」を付けるか
let forcedMarks=[];       // [{time:Date, minutes:number, done:boolean}]
let lastMinuteTs=0;       // 直近で処理した分の境界時刻(ms)

// ====== 音声合成 ======
function pickJaVoice(){
  if(!('speechSynthesis' in window)) return;
  const v=speechSynthesis.getVoices();
  const jaVoices=v.filter(vv=>vv.lang && vv.lang.startsWith('ja'));
  const isEnhanced=vv=>((vv.name||'').toLowerCase().includes('enhanced'));
  jaVoice = jaVoices.find(vv=>isEnhanced(vv) && (vv.name||'').includes('Kyoko'))
         || jaVoices.find(vv=>isEnhanced(vv) && (vv.name||'').includes('Otoya'))
         || jaVoices.find(vv=>(vv.name||'').includes('Kyoko'))
         || jaVoices.find(vv=>(vv.name||'').includes('Otoya'))
         || jaVoices[0] || null;
}

function beep(){
  try{
    ensureAudioCtx();
    const now=audioCtx.currentTime;
    const o=audioCtx.createOscillator();
    const g=audioCtx.createGain();
    o.type='sine'; o.frequency.value=880;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now+0.18);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(now); o.stop(now+0.18);
  }catch(e){/* ignore */}
}

function speakOrBeep(msg){
  if('speechSynthesis' in window && audioUnlocked){
    try{
      if(!jaVoice) pickJaVoice();
      const u=new SpeechSynthesisUtterance(msg);
      u.lang='ja-JP'; if(jaVoice) u.voice=jaVoice;
      u.pitch=1.0; u.rate=0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }catch(e){ beep(); }
  }else{
    beep();
  }
}

// ====== タップで開始 ======
function unlock(){
  audioUnlocked=true;
  ensureAudioCtx();
  gate.style.display='none';
  // ベースラインやスケジュールは initBaseline/reset が担当
}
gateBtn.onclick=unlock;

// 初期シャドウ基準とN分スケジュールをセット（音のアンロックはしない）
function initBaseline(){
  started=true; // 画面描画/スケジュールは開始
  startTime=new Date();
  startSec=startTime.getSeconds();
  startMin=startTime.getMinutes()+startSec/60;
  startHour=(startTime.getHours()%12)+startMin/60;
  scheduleNextNFrom(startTime);
  // 初期のアイコン/単位表示
  if(range){
    const v=parseInt(range.value,10);
    if(!isNaN(v)) N=v;
    nVal.textContent = (N<=0)? 'なし' : N;
    if(nUnit) nUnit.textContent = (N<=0)? '' : '分ごと';
    if(soundIcon) soundIcon.textContent = (N<=0)? '🔈' : '🔊';
  }
}

// ドラッグなど最初のユーザー操作で音をアンロック
function ensureAudioUnlocked(){
  if(audioUnlocked) return;
  unlock();
}

initBaseline();

// 初期状態に戻す
// ちょっとしたお楽しみ: 端からのコンフェッティ
function confettiBurst(){
  const layerId='confettiLayer';
  let layer=document.getElementById(layerId);
  if(!layer){
    layer=document.createElement('div');
    layer.id=layerId; document.body.appendChild(layer);
  }
  const side = Math.random()<0.5 ? 'left' : 'right';
  const colors=['#ff3b30','#ff9500','#ffcc00','#34c759','#5ac8fa','#007aff','#af52de'];
  const count=60;
  const W=window.innerWidth, H=window.innerHeight;
  for(let i=0;i<count;i++){
    const el=document.createElement('div');
    el.className='confetti';
    const size=6+Math.random()*6|0;
    el.style.width=size+'px'; el.style.height=size+'px';
    el.style.background=colors[(Math.random()*colors.length)|0];
    el.style.top=(H-16)+'px';
    if(side==='left'){ el.style.left='16px'; }
    else{ el.style.right='16px'; }
    el.style.transform='translate(0,0) rotate(0deg)';
    el.style.opacity='1';
    el.classList.add('move');
    layer.appendChild(el);
    const dx=(side==='left'?1:-1)*(180+Math.random()*420);
    const dy=-(220+Math.random()*380);
    const rot=(-180+Math.random()*360)|0;
    requestAnimationFrame(()=>{
      el.style.transform=`translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
      el.style.opacity='0';
    });
    setTimeout(()=>{ el.remove(); }, 1400);
  }
  // layer自体は維持（使い回し）
}
function showRemainTime(ms){
  // ms から残り分を算出し、画面中央に表示する
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const text = `${minutes}分`;

  const el = document.createElement('div');
  el.className = 'remainEffect';
  el.textContent = text;
  const clock = document.getElementById('clock');
  if (clock) {
    const rect = clock.getBoundingClientRect();
    const fontSize = rect.width / Math.max(1, text.length);
    el.style.fontSize = fontSize + 'px';
  }
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); }, 1300);
}

function resetState(){
  dragging=false; dragMinIdx=null;
  timerLocked=false; timerSet=false;
  endMinuteIdx=null; timerSetTime=null;
  timerStartAngle=null; timerEndAngle=null;
  endDate=null; endAnnounced=false; overrunStart=null;
  forcedMarks=[];
  startTime=new Date();
  startSec=startTime.getSeconds();
  startMin=startTime.getMinutes()+startSec/60;
  startHour=(startTime.getHours()%12)+startMin/60;
  scheduleNextNFrom(startTime);
  if(actions) actions.style.display='none';
  if(preMsg) preMsg.style.display='block';
  if(nextBtn) nextBtn.disabled=false;
  resizeCanvas();
}

function onNext(){
  if(nextBtn) nextBtn.disabled=true;
  const now = new Date();
  if (timerSet && endDate && now < endDate) {
    showRemainTime(endDate - now);
  } else {
    confettiBurst();
  }
  setTimeout(resetState,1300);
}

function onResetAlarm(){
  resetState();
}

nextBtn.onclick=onNext;
if(resetBtn) resetBtn.onclick=resetState;

// ====== Nを変更したらリスタート ======
function updateSoundUI(){
  if(nUnit) nUnit.textContent = (N<=0)? '' : '分ごと';
  if(soundIcon) soundIcon.textContent = (N<=0)? '🔈' : '🔊';
}
// アナウンス間隔スライダー: 目盛りは参照用とし、1分単位で調整可能
range.oninput=e=>{
  let v=parseInt(e.target.value,10);
  if(isNaN(v)) v=0;
  N=v;
  nVal.textContent=(N<=0)?'なし':N;
  updateSoundUI();
  if(started){
    startTime=new Date();
    startSec=startTime.getSeconds();
    // 影はリセットしない
    scheduleNextNFrom(startTime);
  }
};

// ====== 角度/分変換ユーティリティ ======
const TAU=2*Math.PI;
const angleForMinute=(m)=>TAU*(m/60)-Math.PI/2; // m: 分(小数可)
const normalize=(a)=>{a%=TAU; if(a<0) a+=TAU; return a;};
const cwDelta=(a0,a1)=>{let d=a1-a0; if(d<0) d+=TAU; return d;}; // a0 -> a1 時計回り差
function pointerAngle(e){
  const rect=clock.getBoundingClientRect();
  const x=(e.clientX-rect.left)-rect.width/2;
  const y=(e.clientY-rect.top)-rect.height/2;
  return Math.atan2(y,x);
}
function minuteIndexFromAngle(a){
  const m=((a+Math.PI/2)/TAU)*60; // 連続値
  let idx=Math.round(m)%60; if(idx<0) idx+=60; return idx;
}
function minutesCeilFromAngles(aNow,aEnd){
  const remainAngle=cwDelta(aNow,aEnd); // [0, 2π)
  const mins=remainAngle/TAU*60;
  return Math.max(0, Math.ceil(mins));
}

// mm:00に揃える/スケジュール補助
function roundToNearestMinute(d){
  const nd=new Date(d);
  const secs=nd.getSeconds();
  nd.setMilliseconds(0);
  if(secs>=30){ nd.setSeconds(0); nd.setMinutes(nd.getMinutes()+1); }
  else{ nd.setSeconds(0); }
  return nd;
}
function addMinutes(d,mins){ const nd=new Date(d); nd.setMinutes(nd.getMinutes()+mins); return nd; }
function scheduleNextNFrom(base){
  if(!N || N<=0){ nNextAnnounce=null; nFirstApprox=false; return; }
  const cand=addMinutes(base,N);
  nNextAnnounce=roundToNearestMinute(cand);
  const s = base.getSeconds();
  nFirstApprox = (Math.abs(s) > 1e-6);
}
function computeEndDate(now, endMinIdx){
  const ed=new Date(now);
  ed.setMilliseconds(0);
  ed.setSeconds(0);
  ed.setMinutes(endMinIdx);
  if(ed <= now){ ed.setHours(ed.getHours()+1); }
  return ed;
}

// ====== 分針ドラッグ（設定は一度だけ） ======
function updateDrag(e){
  const a=pointerAngle(e);
  dragMinIdx=minuteIndexFromAngle(a);
  drawClock();
}
function commitTimer(){
  if(dragMinIdx==null) return;
  const now=new Date();
  timerSetTime=now;
  const sec=now.getSeconds();
  const minNow=now.getMinutes()+sec/60; // 小数
  timerStartAngle=angleForMinute(minNow);
  endMinuteIdx=dragMinIdx;
  timerEndAngle=angleForMinute(endMinuteIdx);
  timerSet=true; timerLocked=true; dragging=false;
  // 終了の実日時（mm:00）
  endDate = computeEndDate(now, endMinuteIdx);
  endAnnounced=false;
  // 超過の脈動は終了で開始するのでリセット
  overrunStart=null;
  // N分アナウンスのスケジュールをセット
  scheduleNextNFrom(now);
  // 残り1/3/5分の強制アナウンスをスケジュール
  forcedMarks = [1,3,5]
    .map(m => ({ minutes:m, time:addMinutes(endDate, -m), done:false }))
    .filter(o => o.time > now);
  // セット時のアナウンス
  const remainMs = Math.max(0, endDate - now);
  const rSec = Math.floor((remainMs/1000)%60);
  const rMin = Math.floor(remainMs/60000);
  const endH24 = endDate.getHours();
  const endH = (endH24%12)||12;
  const endM = endDate.getMinutes();
  speakOrBeep(`タイマースタート。${endH}時${endM}分まであと${rMin}分${rSec}秒です`);
  if(actions) actions.style.display='flex';
  if(preMsg) preMsg.style.display='none';
  resizeCanvas();
  drawClock();
}
function onPointerDown(e){
  ensureAudioUnlocked();
  if(!started || timerLocked) return;
  dragging=true; updateDrag(e);
  try{ clock.setPointerCapture(e.pointerId); }catch(_){/* noop */}
  e.preventDefault();
}
function onPointerMove(e){ if(dragging && !timerLocked){ updateDrag(e); e.preventDefault(); } }
function onPointerUp(e){ if(!dragging||timerLocked) return; commitTimer(); try{clock.releasePointerCapture(e.pointerId);}catch(_){/* noop */} e.preventDefault(); }
clock.addEventListener('pointerdown', onPointerDown, {passive:false});
clock.addEventListener('pointermove', onPointerMove, {passive:false});
clock.addEventListener('pointerup', onPointerUp, {passive:false});

// ====== 経過チェック ======
function tick(){
  if(!started) return;
  const now=new Date();
  // 毎分の境界でのみアナウンス処理（秒針が12の位置）
  const minuteStartTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0).getTime();
  if(minuteStartTs !== lastMinuteTs){
    lastMinuteTs = minuteStartTs;

    // 終了判定（mm:00）
    if(timerSet && endDate && !endAnnounced && minuteStartTs >= endDate.getTime()){
      endAnnounced=true;
      const h=((endDate.getHours()%12)||12);
      const m=endDate.getMinutes();
      speakOrBeep(`はい、終わりです。${h}時${m}分になりました`);
      if(!overrunStart) overrunStart=now;
      if(nNextAnnounce) nNextAnnounce = addMinutes(endDate, N);
      return;
    }

    // 残り1/3/5分の強制アナウンス（mm:00ぴったり）
    if(timerSet && endDate && forcedMarks && forcedMarks.length){
      const due = forcedMarks.filter(m=>!m.done && m.time.getTime() === minuteStartTs && minuteStartTs < endDate.getTime());
      if(due.length){
        due.sort((a,b)=>a.minutes-b.minutes);
        const m = due[0];
        speakOrBeep(`はい、あと${m.minutes}分です`);
        m.done=true; // 到来分のみ完了
        // 同分のN分アナウンスはスキップ（スケジュールを次へ送る）
        while(nNextAnnounce && minuteStartTs >= nNextAnnounce.getTime()) nNextAnnounce = addMinutes(nNextAnnounce, N);
        return;
      }
    }

    // N分ごとのアナウンス（mm:00）
    if(nNextAnnounce && minuteStartTs >= nNextAnnounce.getTime()){
      let msg='';
      if(timerSet && endDate && minuteStartTs >= endDate.getTime()){
        const h=((endDate.getHours()%12)||12);
        const m=endDate.getMinutes();
        const overMin = Math.max(0, Math.floor((minuteStartTs - endDate.getTime())/60000));
        msg = `${h}時${m}分からもう${overMin}分がすぎています`;
      }else{
        if(timerSet && endDate){
          const diffMs=endDate.getTime() - minuteStartTs;
          const remainMin = Math.max(0, Math.ceil(diffMs/60000));
          if(nFirstApprox){
            msg = `はい、だいたい${N}分たちました、あと${remainMin}分です`;
            nFirstApprox=false;
          }else{
            msg = `はい、${N}分たちました、あと${remainMin}分です`;
          }
        }else{
          if(nFirstApprox){
            msg = `はい、だいたい${N}分たちました`;
            nFirstApprox=false;
          }else{
            msg = `はい、${N}分たちました`;
          }
        }
      }
      speakOrBeep(msg);
      if(navigator.vibrate) navigator.vibrate([200,80,200]);
      nNextAnnounce = addMinutes(nNextAnnounce, N);
    }
  }
}

// DPI-aware canvas sizing
function resizeCanvas(){
  const margin = 12;
  const controls = document.getElementById('controls');
  const availW = Math.max(100, window.innerWidth - margin*2);
  const availH = Math.max(100, window.innerHeight - (controls?controls.offsetHeight:0) - ACTIONS_H - margin*2);
  const size = Math.floor(Math.min(availW, availH));

  // apply CSS size
  clock.style.width = size + 'px';
  clock.style.height = size + 'px';

  const rect = clock.getBoundingClientRect();
  const dpr = Math.max(window.devicePixelRatio||1,1);
  // match physical pixels
  clock.width = Math.round(rect.width * dpr);
  clock.height = Math.round(rect.height * dpr);
  // reset transform and scale to devicePixelRatio so drawing uses CSS pixels
  if(typeof ctx.resetTransform === 'function') ctx.resetTransform();
  else ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr,dpr);

  // update control text sizing to ~2/3 of numeral size
  const R = Math.min(rect.width, rect.height) / 2 - 16;
  const ctrlPx = Math.max(12, Math.round(R*0.14*2/3));
  document.documentElement.style.setProperty('--ctrl-size', ctrlPx+'px');
  document.documentElement.style.setProperty('--pill-min-w', Math.round(ctrlPx*5.6)+'px');
  // center controls to same width as clock
  const controlsEl = document.getElementById('controls');
  if(controlsEl){ controlsEl.style.width = rect.width + 'px'; }
  const actionsSpaceEl = document.getElementById('actionsSpace');
  if(actionsSpaceEl){ actionsSpaceEl.style.width = rect.width + 'px'; }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ====== 時計描画 ======
function drawClock(){
  const dpr = window.devicePixelRatio || 1;
  const cssW = clock.getBoundingClientRect().width;
  const cssH = clock.getBoundingClientRect().height;
  const cx = cssW / 2, cy = cssH / 2;
  const R = Math.min(cssW, cssH) / 2 - 16;

  // Save the pristine (unscaled) context state
  ctx.save();
  // Reset transform and apply scale for the current frame
  if(typeof ctx.resetTransform === 'function') ctx.resetTransform();
  else ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr,dpr);

  // clear using CSS pixel extents
  ctx.clearRect(0,0,cssW,cssH);
  ctx.save(); ctx.translate(cx,cy);

  // 1. 盤
  ctx.beginPath(); ctx.arc(0,0,R,0,2*Math.PI);
  ctx.fillStyle='#fff'; ctx.fill();
  ctx.lineWidth=4; ctx.strokeStyle='#e1e4ec'; ctx.stroke();

  const now=new Date();

  // 2. タイマー扇形（青/残り濃い、超過は赤）
  function fillSector(r, a0, a1, rgba){
    let end=a1;
    if(end<a0) end+=TAU;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,r,a0,end,false);
    ctx.closePath();
    ctx.fillStyle=rgba;
    ctx.fill();
  }
  if(timerSet && timerStartAngle!=null && timerEndAngle!=null){
    const rWedge = R*0.78; // 分針長さに等しい半径
    const secNow = now.getSeconds();
    const minNow = now.getMinutes()+secNow/60;
    const aNowMin = 2*Math.PI*(minNow/60)-Math.PI/2;

    const plannedStart = timerStartAngle;
    const plannedEnd   = timerEndAngle;
    const plannedSpan  = cwDelta(plannedStart, plannedEnd);
    const remainSpan   = cwDelta(aNowMin, plannedEnd);

    // 以前の配色に戻す: 全体を淡い青、その上に残りを濃い青、超過は赤
    ctx.globalAlpha=1;
    fillSector(rWedge, plannedStart, plannedEnd, 'rgba(0, 122, 255, 0.20)');

    if(remainSpan > 0 && remainSpan <= plannedSpan){
      // 残り（濃い青）: 現在→終了
      fillSector(rWedge, aNowMin, plannedEnd, 'rgba(0, 122, 255, 0.55)');
    }else{
      // 終了を過ぎた: 終了→現在を赤
      fillSector(rWedge, plannedEnd, aNowMin, 'rgba(220, 0, 0, 0.35)');
    }
    ctx.globalAlpha=1;
  }

  // 3. 目盛
  for(let i=0;i<60;i++){
    const a=2*Math.PI*i/60-Math.PI/2;
    const long=i%5==0;
    const rOuter=R-10, rInner=long?R-30:R-20;
    ctx.beginPath();
    ctx.moveTo(rInner*Math.cos(a),rInner*Math.sin(a));
    ctx.lineTo(rOuter*Math.cos(a),rOuter*Math.sin(a));
    ctx.lineWidth=long?4:2;
    ctx.strokeStyle=long?'#aeb4c4':'#d3d7e3';
    ctx.stroke();
  }

  // 4. 数字
  ctx.fillStyle='#111';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font=`${Math.round(R*0.14)}px system-ui`;
  for(let n=1;n<=12;n++){
    const a=2*Math.PI*n/12-Math.PI/2;
    const x=(R-50)*Math.cos(a), y=(R-50)*Math.sin(a);
    ctx.fillText(n,x,y);
  }

  // 5. 針 (現在時刻)
  const sec=now.getSeconds();
  const min=now.getMinutes()+sec/60;
  const hr=(now.getHours()%12)+min/60;
  const aHr=2*Math.PI*(hr/12)-Math.PI/2;
  const aMin=2*Math.PI*(min/60)-Math.PI/2;
  const aSec=2*Math.PI*(sec/60)-Math.PI/2;

  function hand(len,width,ang,col='#111'){
    const x = len * Math.cos(ang);
    const y = len * Math.sin(ang);
    ctx.beginPath();
    ctx.lineWidth=width;
    ctx.lineCap='round';
    ctx.strokeStyle=col;
    ctx.moveTo(0,0);
    ctx.lineTo(x,y);
    ctx.stroke();
  }

  function drawBubble(text, px, py, ang){
    ctx.save();
    ctx.translate(px, py);
    ctx.font = `${Math.round(R*0.11)}px system-ui`;
    // move inward: base 40px + half-width char for extra clearance (avoid hiding the tip when horizontal)
    const charW = ctx.measureText('0').width || 8;
    const inward = 40 + Math.min(16, Math.max(6, charW*0.6));
    const ox = -inward*Math.cos(ang);
    const oy = -inward*Math.sin(ang);
    ctx.translate(ox, oy);
    const paddingX=10, paddingY=6;
    const metrics = ctx.measureText(text);
    const w = Math.round(metrics.width) + paddingX*2;
    const h = Math.round(R*0.16);
    const r = Math.min(12, h/2);
    ctx.fillStyle = '#007aff';
    ctx.strokeStyle='rgba(0,0,0,0.08)';
    ctx.lineWidth=1;
    // rounded rect
    ctx.beginPath();
    ctx.moveTo(-w/2 + r, -h/2);
    ctx.lineTo(w/2 - r, -h/2);
    ctx.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + r);
    ctx.lineTo(w/2, h/2 - r);
    ctx.quadraticCurveTo(w/2, h/2, w/2 - r, h/2);
    ctx.lineTo(-w/2 + r, h/2);
    ctx.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - r);
    ctx.lineTo(-w/2, -h/2 + r);
    ctx.quadraticCurveTo(-w/2, -h/2, -w/2 + r, -h/2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // text
    ctx.fillStyle='#fff';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // 影の針を描画
  if(startHour !== null && startMin !== null){
    const aStartHr=2*Math.PI*(startHour/12)-Math.PI/2;
    const aStartMin=2*Math.PI*(startMin/60)-Math.PI/2;
    hand(R*0.55,15,aStartHr,'rgba(0,0,0,0.2)');
    hand(R*0.78,10,aStartMin,'rgba(0,0,0,0.2)');
  }

  // 明滅制御（終了後は時針/分針、未設定時は分針のみ）
  function pulseColor(t0){
    const t = (now - t0); // ms
    const period = 1200; // 1.2s で鼓動
    const p = 0.5 - 0.5*Math.cos((2*Math.PI*(t%period))/period); // [0,1]
    const grayStart = 160; // 影(#ccc≒204)より濃いグレー
    const black = 17;      // #111
    const shade = Math.round(grayStart - (grayStart - black) * p);
    return `rgb(${shade},${shade},${shade})`;
  }
  let hrColor = '#111';
  let mnColor = '#111';
  if(endAnnounced && overrunStart){
    hrColor = pulseColor(overrunStart);
    mnColor = hrColor;
  }else if(!timerSet){
    mnColor = pulseColor(startTime||now);
  }
  hand(R*0.55,15,aHr,hrColor);
  // 分針: ドラッグ中はスナップ角を表示、確定後は通常時刻を表示
    if(dragging && !timerLocked && dragMinIdx!=null){
      const aDrag=2*Math.PI*(dragMinIdx/60)-Math.PI/2;
      hand(R*0.78,10,aDrag,mnColor);
      // 吹き出し（何分を指しているか）
      const tipX = R*0.78*Math.cos(aDrag);
      const tipY = R*0.78*Math.sin(aDrag);
      drawBubble(`${dragMinIdx}分`, tipX, tipY, aDrag);
    }else{
      hand(R*0.78,10,aMin,mnColor);
    }
  hand(R,5,aSec,'#d11');

  // 6. 中心
  ctx.beginPath(); ctx.arc(0,0,8,0,2*Math.PI);
  ctx.fillStyle='#111'; ctx.fill();

  ctx.restore(); // restore from translate(cx,cy)
  ctx.restore(); // restore from scale(dpr,dpr)
}

// ====== 更新ループ ======
function isPulsing(){ return !timerSet || (endAnnounced && overrunStart); }
let fps = isPulsing() ? 60 : 1;
function update(){ drawClock(); tick(); adjustLoop(); }
let loopHandle;
function startLoop(){
  if(!loopHandle){
    update();
    loopHandle=setInterval(update,1000/fps);
  }
}
function stopLoop(){
  if(loopHandle){
    clearInterval(loopHandle);
    loopHandle=null;
  }
}
function adjustLoop(){
  const desired = isPulsing() ? 60 : 1;
  if(desired !== fps){
    fps = desired;
    if(loopHandle){
      clearInterval(loopHandle);
      loopHandle=setInterval(update,1000/fps);
    }
  }
}
function setLoop(active){ active ? startLoop() : stopLoop(); }
startLoop();
document.addEventListener('visibilitychange', ()=>setLoop(!document.hidden));


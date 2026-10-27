/* Original Canvas art, synthesized audio, and browser input. No external assets. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!window.EmberCore) { $('fatalError').hidden = false; return; }
  const canvas = $('arena');
  const ctx = canvas.getContext('2d', { alpha: false });
  let selectedArena=readSetting('ember-arena-v2','conduit');
  if(!['conduit','foundry'].includes(selectedArena))selectedArena='conduit';
  const game = EmberCore.createGame({ seed: Date.now() >>> 0, arena:selectedArena });
  const progressStore=window.EmberProgress?EmberProgress.createStore():null;
  let progress=progressStore?.read()||{challenges:[],trails:[],selectedTrail:'default'},runId='';
  let shakeLevel=Number(readSetting('ember-shake-v2','1'));
  if(![0,.45,1].includes(shakeLevel))shakeLevel=1;
  let hapticEnabled=readSetting('ember-haptic-v2','0')==='1',lastHaptic=0;
  const hapticSupported=typeof navigator!=='undefined'&&typeof navigator.vibrate==='function';
  let feedbackOpen=false,feedbackResume=false,hitStopRemaining=0;
  const C = { mint:'#69e6c4', lime:'#c6f784', orange:'#ff9c69', red:'#ff6d72', ink:'#0a1519', muted:'#537971' };
  const names = Object.fromEntries(EmberCore.UPGRADES.map(upgrade=>[upgrade.id,upgrade.name]));
  const symbols = {power:'✦',haste:'≋',multishot:'⋔',pierce:'↗',chain:'ϟ',nova:'✺',frost:'❄',speed:'»',vitality:'✚',magnet:'◎',siphon:'◈',dash:'↗',orbit:'◌',regen:'✚',crit:'✧',armor:'⬡'};
  let width=0, height=0, dpr=1, zoom=1, camera={x:0,y:0};
  let lastTime=0, previousMode='', choiceReady=0, lastChoiceKey='', aimHeld=false, dashQueued=false;
  let pointerWorld={x:0,y:0}, pointerScreen={x:0,y:0};
  const keys = new Set();
  const stick={id:null,x:0,y:0,cx:0,cy:0};
  let touchMode=matchMedia('(pointer:coarse)').matches||innerWidth<=700;
  let audioEnabled=readSetting('ember-audio','1')==='1';
  let reducedMotion=readSetting('ember-motion',matchMedia('(prefers-reduced-motion:reduce)').matches?'1':'0')==='1';
  let audioContext=null, audioMaster=null, audioTimes={};
  let frameStats={frames:0,elapsed:0,fps:60,maxFrame:0};
  const errors=[];
  addEventListener('error', e=>errors.push(String(e.message)));
  addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));

  function readSetting(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
  function saveSetting(key,val){try{localStorage.setItem(key,val);}catch{/* Private browser mode may block storage. */}}
  function resize(){
    width=canvas.clientWidth; height=canvas.clientHeight; dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
    zoom=Math.min(1.15,Math.max(.52,Math.min(width/920,height/680)));
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if(width<=700){touchMode=true;document.body.classList.add('is-touch');}
  }
  addEventListener('resize',resize); resize();
  function timeText(t){return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function clearInput(){keys.clear();stick.x=stick.y=0;stick.id=null;dashQueued=false;aimHeld=false;$('joystickKnob').style.transform='';}
  function start(){
    if(!['menu','dead','won','paused'].includes(game.state.mode))return;
    clearInput(); unlockAudio();
    game.restart({arena:selectedArena});runId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);hitStopRemaining=0;
    previousMode='';lastChoiceKey='';syncUI();canvas.focus({preventScroll:true});
  }
  $('startButton').addEventListener('click',start);
  $('restartButton').addEventListener('click',start);
  $('pauseRestartButton').addEventListener('click',start);
  $('menuButton').addEventListener('click',()=>{game.restart({arena:selectedArena});game.state.mode='menu';clearInput();previousMode='';renderProgress();syncUI();});
  for(const [id,arena]of [['arenaConduit','conduit'],['arenaFoundry','foundry']])$(id).addEventListener('click',()=>{if(game.state.mode!=='menu')return;selectedArena=arena;game.setArena?.(arena);saveSetting('ember-arena-v2',arena);syncArenas();});
  function syncArenas(){for(const [id,arena]of [['arenaConduit','conduit'],['arenaFoundry','foundry']]){$(id).classList.toggle('selected',arena===selectedArena);$(id).setAttribute('aria-pressed',String(arena===selectedArena));}}
  $('trailSelect').addEventListener('change',()=>{progress=progressStore?.selectTrail($('trailSelect').value)||progress;});
  function pause(){if(['playing','paused'].includes(game.state.mode)){game.togglePause();clearInput();syncUI();if(game.state.mode==='playing')canvas.focus({preventScroll:true});}}
  $('pauseButton').addEventListener('click',pause);$('resumeButton').addEventListener('click',pause);
  function setAudioButton(){ $('soundButton').setAttribute('aria-pressed',String(audioEnabled));$('soundButton').innerHTML=`♪<span class="desktop-label"> 音效${audioEnabled?'开':'关'}</span>`;}
  $('soundButton').addEventListener('click',()=>{audioEnabled=!audioEnabled;saveSetting('ember-audio',audioEnabled?'1':'0');unlockAudio();setAudioButton();if(audioEnabled)tone('select');});setAudioButton();
  function setMotionButton(){document.body.classList.toggle('reduce-motion',reducedMotion);$('motionButton').setAttribute('aria-pressed',String(reducedMotion));$('motionButton').title=reducedMotion?'减少动态已开启：震屏和重击停顿关闭':'减少动态已关闭';$('motionHint').textContent=reducedMotion?'已开启“减少动态”，屏幕震动和重击停顿已关闭。':'屏幕震动只影响战场画面。';}
  $('motionButton').addEventListener('click',()=>{reducedMotion=!reducedMotion;if(reducedMotion){hitStopRemaining=0;game.state.hitStop=0;}saveSetting('ember-motion',reducedMotion?'1':'0');setMotionButton();});setMotionButton();
  function pick(index){
    if(game.state.mode!=='upgrade'||performance.now()<choiceReady)return;
    game.chooseUpgrade(index);dashQueued=false;
    choiceReady=performance.now()+300;lastChoiceKey='';syncUI();if(game.state.mode==='playing')canvas.focus({preventScroll:true});
  }
  document.addEventListener('keydown',e=>{
    const inCombat=game.state.mode==='playing';
    const interactive=e.target?.closest?.('button,a');
    if((inCombat&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))||(inCombat&&e.code==='Space'&&!interactive))e.preventDefault();
    if(e.repeat)return;
    if(e.code==='Escape'&&feedbackOpen){closeFeedback();return;}
    if(e.code==='Escape'||e.code==='KeyP'){if(!feedbackOpen)pause();return;}
    if(game.state.mode==='upgrade'&&/^Digit[123]$/.test(e.code)){pick(Number(e.code.slice(-1))-1);return;}
    if(e.code==='Space'&&game.state.mode==='playing'&&!interactive){dashQueued=true;unlockAudio();}
    keys.add(e.code);
  });
  // Keep keyboard focus inside active overlays; Space continues to activate buttons.
  document.addEventListener('keydown',e=>{
    if(e.code!=='Tab')return;
    const id=feedbackOpen?'feedbackOverlay':{upgrade:'upgradeOverlay',paused:'pauseOverlay',dead:'resultOverlay',won:'resultOverlay'}[game.state.mode];
    if(!id)return;const buttons=Array.from($(id).querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled)'));if(!buttons.length)return;
    const current=buttons.indexOf(document.activeElement),next=e.shiftKey?(current<=0?buttons.length-1:current-1):(current+1)%buttons.length;
    e.preventDefault();buttons[next].focus({preventScroll:true});
  });
  document.addEventListener('keyup',e=>keys.delete(e.code));
  function autoPause(){clearInput();if(game.state.mode==='playing'){game.togglePause();syncUI();}}
  addEventListener('blur',autoPause);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)autoPause();});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{
    if(game.state.mode!=='playing'||e.pointerType==='touch')return;
    if(e.button===2)dashQueued=true;else if(e.button===0)aimHeld=true;
    updatePointer(e);unlockAudio();
  });
  canvas.addEventListener('pointermove',updatePointer);
  addEventListener('pointerup',e=>{if(e.button===0&&e.pointerType!=='touch')aimHeld=false;});
  function updatePointer(e){pointerScreen.x=e.clientX;pointerScreen.y=e.clientY;pointerWorld.x=camera.x+(e.clientX-width/2)/zoom;pointerWorld.y=camera.y+(e.clientY-height/2)/zoom;}
  function useTouch(){touchMode=true;document.body.classList.add('is-touch');syncUI();}
  const joystick=$('joystick');
  joystick.addEventListener('pointerdown',e=>{
    e.preventDefault();if(stick.id!==null||game.state.mode!=='playing')return;
    useTouch();unlockAudio();stick.id=e.pointerId;
    const rect=joystick.getBoundingClientRect();stick.cx=rect.left+rect.width/2;stick.cy=rect.top+rect.height/2;
    joystick.setPointerCapture(e.pointerId);moveStick(e);
  });
  function moveStick(e){
    if(e.pointerId!==stick.id)return;e.preventDefault();
    const dx=e.clientX-stick.cx,dy=e.clientY-stick.cy;const length=Math.hypot(dx,dy),range=joystick.clientWidth*.33;
    const scale=length>range?range/length:1;
    stick.x=dx*scale/range;stick.y=dy*scale/range;
    $('joystickKnob').style.transform=`translate(${dx*scale}px,${dy*scale}px)`;
  }
  joystick.addEventListener('pointermove',moveStick);
  function stopStick(e){if(e.pointerId===stick.id){stick.id=null;stick.x=stick.y=0;$('joystickKnob').style.transform='';}}
  ['pointerup','pointercancel','lostpointercapture'].forEach(name=>joystick.addEventListener(name,stopStick));
  $('dashButton').addEventListener('pointerdown',e=>{e.preventDefault();useTouch();unlockAudio();if(game.state.mode==='playing')dashQueued=true;});
  $('dashButton').addEventListener('click',e=>{if(e.detail===0&&game.state.mode==='playing'){dashQueued=true;unlockAudio();}});
  document.body.classList.toggle('is-touch',touchMode);
  for(const id of ['upgradeOverlay','pauseOverlay','resultOverlay']){$(id).setAttribute('role','dialog');$(id).setAttribute('aria-modal','true');}
  $('feedbackButton').addEventListener('click',()=>{feedbackResume=game.state.mode==='playing';if(feedbackResume)game.togglePause();feedbackOpen=true;clearInput();$('shakeSelect').value=String(shakeLevel);$('hapticToggle').checked=hapticEnabled;$('hapticToggle').disabled=!hapticSupported;$('hapticHint').textContent=hapticSupported?'震动效果取决于设备和系统设置。':'当前浏览器不支持操作震动。';syncUI();$('shakeSelect').focus({preventScroll:true});});
  $('shakeSelect').addEventListener('change',()=>{shakeLevel=Number($('shakeSelect').value);saveSetting('ember-shake-v2',String(shakeLevel));});
  $('hapticToggle').addEventListener('change',()=>{hapticEnabled=hapticSupported&&$('hapticToggle').checked;saveSetting('ember-haptic-v2',hapticEnabled?'1':'0');if(hapticEnabled)pulseHaptic('dash');else if(hapticSupported){try{navigator.vibrate(0);}catch{/* Optional hardware feedback may be unavailable. */}}});
  $('feedbackClose').addEventListener('click',closeFeedback);
  function closeFeedback(){feedbackOpen=false;if(feedbackResume&&game.state.mode==='paused')game.togglePause();feedbackResume=false;syncUI();if(game.state.mode==='playing')canvas.focus({preventScroll:true});else $('feedbackButton').focus({preventScroll:true});}
  function pulseHaptic(event){if(!hapticSupported||!hapticEnabled||performance.now()-lastHaptic<120)return;const ms=event==='hurt'?24:event==='dash'?14:event==='heavy'?9:0;if(!ms)return;lastHaptic=performance.now();try{navigator.vibrate(ms);}catch{}}
  function renderProgress(){
    progress=progressStore?.read()||progress;const holder=$('menuChallenges');holder.replaceChildren();
    for(const c of progress.challenges){const row=document.createElement('div');row.className='challenge-row';const label=document.createElement('span');label.textContent=(c.unlocked?'✓ ':'')+c.name;const count=document.createElement('strong');count.textContent=c.unlocked?'已解锁':`${Math.floor(c.value)} / ${c.target}`;const detail=document.createElement('small');detail.textContent=c.description+' → '+(progress.trails.find(t=>t.id===c.reward)?.name||'新拖尾');const track=document.createElement('div');track.className='challenge-track';const fill=document.createElement('i');fill.style.width=`${clamp(c.value/c.target*100,0,100)}%`;track.append(fill);row.append(label,count,detail,track);holder.append(row);}
    const select=$('trailSelect');select.replaceChildren();for(const trail of progress.trails){const opt=document.createElement('option');opt.value=trail.id;opt.textContent=trail.name+(trail.unlocked?'':' · 未解锁');opt.disabled=!trail.unlocked;select.append(opt);}select.value=progress.selectedTrail;
  }

  function unlockAudio(){
    if(!audioEnabled)return;
    try{
      if(!audioContext){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;audioContext=new Audio();audioMaster=audioContext.createGain();audioMaster.gain.value=.22;audioMaster.connect(audioContext.destination);}
      if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
    }catch{/* Audio is optional. */}
  }
  function tone(event){
    if(!audioEnabled||!audioContext||audioContext.state!=='running')return;
    const t=audioContext.currentTime;
    const cooldown=event==='shoot'?.085:event==='hit'?.06:.025;
    if(t-(audioTimes[event]??-1)<cooldown)return;audioTimes[event]=t;
    const tones={shoot:[710,210,.045,'triangle',.16],hit:[230,65,.065,'triangle',.35],crit:[850,210,.11,'square',.14],heavy:[125,35,.13,'triangle',.58],kill:[440,85,.11,'sine',.32],dash:[160,620,.13,'sawtooth',.21],hurt:[100,35,.19,'sawtooth',.22],level:[480,980,.3,'sine',.4],select:[420,840,.13,'triangle',.25],elite:[150,75,.5,'triangle',.4],win:[400,1200,.8,'sine',.4],lose:[230,40,.8,'triangle',.35],chain:[950,350,.08,'sine',.2]};
    const spec=tones[event];if(!spec)return;
    try{const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=spec[3];osc.frequency.setValueAtTime(spec[0],t);osc.frequency.exponentialRampToValueAtTime(spec[1],t+spec[2]);gain.gain.setValueAtTime(spec[4],t);gain.gain.exponentialRampToValueAtTime(.001,t+spec[2]);osc.connect(gain);gain.connect(audioMaster);osc.start(t);osc.stop(t+spec[2]);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{}
  }
  function consumeAudio(){const events=game.state.events;if(!events)return;const names=events.splice(0).map(event=>typeof event==='string'?event:event.type);const priority=new Set(['hurt','dash','heavy','elite','level','select','win','lose']);const important=[...new Set(names.filter(name=>priority.has(name)))];const ordinary=names.filter(name=>!priority.has(name)).slice(-(20-important.length));for(const name of [...important,...ordinary]){tone(name);pulseHaptic(name);}}

  function syncUI(){
    const s=game.state,p=s.player,m=s.mode;
    $('gameShell').dataset.diagnostics=JSON.stringify({mode:m,arena:s.arena,time:+s.time.toFixed(2),x:+p.x.toFixed(1),y:+p.y.toFixed(1),hp:p.hp,level:p.level,kills:s.kills,dash:p.dashCooldown,fps:frameStats.fps,enemies:s.enemies.length,hazards:s.hazards?.length||0,errors:errors.length,shake:shakeLevel,reducedMotion,feedbackOpen});
    const menu=m==='menu',active=['playing','paused','upgrade'].includes(m), ended=m==='dead'||m==='won';
    $('menuOverlay').hidden=!menu;$('upgradeOverlay').hidden=m!=='upgrade';$('pauseOverlay').hidden=m!=='paused'||feedbackOpen;$('resultOverlay').hidden=!ended;$('feedbackOverlay').hidden=!feedbackOpen;
    $('hud').hidden=!active;$('buildHud').hidden=!active;$('dashHud').hidden=!active;$('pauseButton').hidden=!['playing','paused'].includes(m);
    $('touchControls').hidden=!(touchMode&&m==='playing');
    document.body.classList.toggle('is-playing',!menu);
    if(m!==previousMode){
      if(m==='upgrade'){choiceReady=performance.now()+300;dashQueued=false;}
      if(m!=='playing')aimHeld=false;
      if(m==='paused'&&!feedbackOpen)$('resumeButton').focus({preventScroll:true});
      if(ended){renderResult();$('restartButton').focus({preventScroll:true});}
      previousMode=m;
    }
    if(menu)return;
    $('hpText').textContent=`${Math.ceil(Math.max(0,p.hp))} / ${p.maxHp}`;$('hpFill').style.width=`${clamp(p.hp/p.maxHp*100,0,100)}%`;
    $('hpFill').style.background=p.hp/p.maxHp<.3?C.red:C.lime;
    $('levelText').textContent=`LV. ${String(p.level).padStart(2,'0')}`;$('xpFill').style.width=`${clamp(p.xp/p.xpNext*100,0,100)}%`;
    $('clockText').innerHTML=`${timeText(s.time)} <small>/ ${s.time>=360?'08:00':'06:00'}</small>`;
    $('phaseText').textContent=s.time>=360?'击败熔断核心':`第 ${s.wave||1} 波 · ${s.wavePhase==='recovery'?'休整':'进攻'}`;
    $('waveHint').textContent=s.time>=360?'在 08:00 前击败核心':s.wavePhase==='recovery'?`${Math.ceil(s.waveRemaining||0)}s 后下一波 · 收集经验`:`${Math.ceil(s.waveRemaining||0)}s 后休整 · 强敌 ${Math.max(0,Math.ceil((Math.floor(s.time/90)+1)*90-s.time))}s`;
    $('buildName').textContent=(s.arena==='foundry'?'熔炉深井':'磁暴回廊')+' / '+(s.buildName||'基础射击');
    $('timeFill').style.width=`${clamp(s.time/360*100,0,100)}%`;$('killText').textContent=String(s.kills).padStart(3,'0');
    $('comboText').textContent=s.combo>1?`${s.combo} 连杀 ${s.combo>=15?'':''}`:'拾取经验升级';
    const cd=p.dashCooldown||0;$('dashText').textContent=cd>0?`冷却 ${cd.toFixed(1)}s`:'冲刺就绪';
    $('dashFill').style.height=`${clamp((1-cd/(p.stats.dashCooldown||3))*100,0,100)}%`;
    $('dashButton').style.opacity=cd>0?'.5':'1';$('dashButton').querySelector('small').textContent=cd>0?`${cd.toFixed(1)}s`:'冲刺';
    const boss=s.boss&&s.boss.hp>0?s.boss:null;$('bossHud').hidden=!boss||!active;if(boss)$('bossFill').style.width=`${clamp(boss.hp/boss.maxHp*100,0,100)}%`;
    $('announcement').textContent=s.eventText||'';$('announcement').style.opacity=active&&s.eventTimer>0?'1':'0';
    const buildKey=JSON.stringify(s.upgrades);
    if($('buildChips').dataset.key!==buildKey){$('buildChips').dataset.key=buildKey;renderBuild($('buildChips'));}
    if(m==='upgrade'){
      const choiceKey=JSON.stringify(s.choices);
      if(choiceKey!==lastChoiceKey){lastChoiceKey=choiceKey;const cards=$('upgradeCards');cards.replaceChildren();s.choices.forEach((choice,index)=>{
        const button=document.createElement('button');button.className='upgrade-card';button.type='button';
        const symbol=document.createElement('span');symbol.className='card-symbol';symbol.textContent=symbols[choice.id]||'✦';
        const key=document.createElement('span');key.className='card-key';key.textContent=String(index+1);
        const tag=document.createElement('span');tag.className='card-tag';tag.textContent=choice.tag||'升级';
        const title=document.createElement('h3');title.textContent=choice.name;
        const desc=document.createElement('p');desc.textContent=choice.description;
        const level=document.createElement('span');level.className='card-level';level.textContent=`等级 ${(choice.level??(s.upgrades[choice.id]||0))+1} / ${choice.maxLevel||5}  ↗`;
        button.append(symbol,key,tag,title,desc,level);button.addEventListener('click',()=>pick(index));cards.append(button);
      });cards.querySelector('button')?.focus({preventScroll:true});}
    }
  }
  function renderBuild(container){container.replaceChildren();const entries=Object.entries(game.state.upgrades||{}).filter(([,v])=>v>0);if(!entries.length){const chip=document.createElement('span');chip.className='build-chip';chip.textContent='基础射击 · 自动开火';container.append(chip);}for(const [id,level]of entries){const chip=document.createElement('span');chip.className='build-chip';chip.textContent=`${symbols[id]||'·'} ${names[id]||id} `;const b=document.createElement('b');b.textContent=`${level}`;chip.append(b);container.append(chip);}}
  function renderResult(){const s=game.state,win=s.mode==='won';$('resultKicker').textContent=win?'核心已击败':'挑战结束';$('resultTitle').innerHTML=win?'胜利<span>.</span>':'挑战失败<span>.</span>';$('resultDescription').textContent=win?`${s.buildName||'基础射击'} · 冲刺击败 ${s.dashKills||0} 个敌人。`:s.time>=479?'本局结束，核心尚未被击败。':`${s.buildName||'基础射击'} · 冲刺击败 ${s.dashKills||0} 个敌人。`;$('resultTime').textContent=timeText(s.time);$('resultKills').textContent=s.kills;$('resultCombo').textContent=s.maxCombo||s.combo||0;renderBuild($('resultBuild'));const recorded=progressStore?.recordRun({runId,kills:s.kills,time:s.time,maxCombo:s.maxCombo||0,mode:s.mode,arena:s.arena});if(recorded){progress=recorded.progress;const unlocked=recorded.newlyUnlocked;const next=progress.challenges.find(c=>!c.unlocked);$('resultChallenge').textContent=unlocked.length?'已解锁拖尾：'+unlocked.map(c=>progress.trails.find(t=>t.id===c.reward)?.name||c.name).join(' / '):next?`未完成挑战 · ${next.description}（${Math.floor(next.value)} / ${next.target}）`:`挑战已全部完成 · 最高连杀 ${progress.bestCombo}。`;}}

  function polygon(x,y,r,sides,angle=0){ctx.beginPath();for(let i=0;i<sides;i++){const a=angle+i*Math.PI*2/sides;i?ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r):ctx.moveTo(x+Math.cos(a)*r,y+Math.sin(a)*r);}ctx.closePath();}
  function circle(x,y,r,color){if(r<=0)return;ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  function ring(x,y,r,color,line=1){if(r<=0)return;ctx.strokeStyle=color;ctx.lineWidth=line;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();}
  function line(x,y,x2,y2,color,w=1){ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();}
  function drawFloor(t){
    const foundry=game.state.arena==='foundry';
    ctx.fillStyle=foundry?'#171719':C.ink;ctx.fillRect(0,0,width,height);
    const left=camera.x-width/(2*zoom),top=camera.y-height/(2*zoom);
    ctx.save();ctx.translate(width/2,height/2);ctx.scale(zoom,zoom);ctx.translate(-camera.x,-camera.y);
    const right=left+width/zoom,bottom=top+height/zoom;
    ctx.lineWidth=1/zoom;ctx.strokeStyle=foundry?'#33292a':'#192d30';ctx.beginPath();
    for(let x=Math.floor(left/80)*80;x<right;x+=80){ctx.moveTo(x,top);ctx.lineTo(x,bottom);}for(let y=Math.floor(top/80)*80;y<bottom;y+=80){ctx.moveTo(left,y);ctx.lineTo(right,y);}ctx.stroke();
    ctx.fillStyle='#36514a';for(let x=Math.floor(left/240)*240;x<right;x+=240)for(let y=Math.floor(top/240)*240;y<bottom;y+=240){ctx.fillRect(x-3,y,6,1);ctx.fillRect(x,y-3,1,6);}
    ring(1200,900,310,'#36524628',2);ring(1200,900,320,'#3652461a');ring(1200,900,150,'#36524628');
    ctx.strokeStyle='#7aa78344';ctx.lineWidth=3;ctx.strokeRect(8,8,2384,1784);ctx.strokeStyle='#c6f78416';ctx.lineWidth=14;ctx.strokeRect(8,8,2384,1784);
    if(foundry){for(let y=Math.floor(top/400)*400;y<bottom;y+=400){line(left,y,right,y,'#d07b3322',7);for(let x=Math.floor(left/160)*160;x<right;x+=160){line(x,y-16,x+24,y+16,'#d07b3330',3);}}}
    ctx.fillStyle=foundry?'#be7b5148':'#5c817343';ctx.font='12px monospace';ctx.textAlign='left';ctx.fillText(foundry?'FOUNDRY // VENT PRESSURE':'CONDUIT // LANE SURGE',1230,935);
    ctx.restore();
  }
  function drawMenu(t){
    ctx.fillStyle=C.ink;ctx.fillRect(0,0,width,height);
    const cx=width*.72,cy=height*.37,r=Math.min(width*.2,height*.26);
    const gradient=ctx.createRadialGradient(cx,cy,0,cx,cy,r*2);gradient.addColorStop(0,'#163d32');gradient.addColorStop(1,C.ink);ctx.fillStyle=gradient;ctx.fillRect(width*.35,70,width*.65,height-70);
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-.35);ctx.scale(1,.55);
    for(let i=0;i<4;i++)ring(0,0,r+i*35,i===1?'#77a36f60':'#38574665');
    for(let i=0;i<20;i++){const a=i*Math.PI/10;line(Math.cos(a)*(r-30),Math.sin(a)*(r-30),Math.cos(a)*(r+110),Math.sin(a)*(r+110),'#2e524944');}
    ctx.restore();
    for(let i=0;i<43;i++){const x=width*.4+(Math.sin(i*42.18)*.5+.5)*width*.58,y=90+(Math.cos(i*11.83)*.5+.5)*(height*.69);const alpha=.18+Math.sin(t*.5+i)*.1;ctx.globalAlpha=alpha;circle(x,y,i%5===0?2:1,C.mint);}ctx.globalAlpha=1;
    ctx.save();ctx.translate(cx,cy);const float=reducedMotion?0:Math.sin(t)*7;ctx.translate(0,float);ctx.rotate(-.35);
    ctx.shadowColor='#9bed8277';ctx.shadowBlur=30;polygon(0,0,41,4,0);ctx.fillStyle='#243e32';ctx.fill();ctx.strokeStyle='#c6f784';ctx.lineWidth=2;ctx.stroke();polygon(0,0,22,4,0);ctx.fillStyle='#c6f784';ctx.fill();ctx.shadowBlur=0;polygon(0,0,8,4,0);ctx.fillStyle='#0c2520';ctx.fill();line(-65,0,-51,0,C.mint,2);line(51,0,65,0,C.mint,2);line(0,-65,0,-51,C.mint,2);line(0,51,0,65,C.mint,2);ctx.restore();
    const ex=cx+r*.94,ey=cy-r*.2;line(cx+40,cy,ex,ey,'#7caf6c60',1);ring(ex,ey,16,'#ff9c6966');polygon(ex,ey,9,3,t*.2);ctx.strokeStyle=C.orange;ctx.stroke();
    ctx.fillStyle='#5a8172';ctx.font='9px monospace';ctx.textAlign='center';ctx.fillText('IGNITION CORE // ONLINE',cx,cy+r*.77);
    const fade=ctx.createLinearGradient(0,0,width,0);fade.addColorStop(0,'#0a1519');fade.addColorStop(.35,'#0a1519e0');fade.addColorStop(.65,'#0a151900');ctx.fillStyle=fade;ctx.fillRect(0,0,width,height);
  }
  function drawWorld(t){
    const s=game.state,p=s.player;
    camera.x=p.x;camera.y=p.y;drawFloor(t);
    ctx.save();let shake=reducedMotion?0:Math.min(s.shake||0,10)*shakeLevel;
    ctx.translate(width/2+(Math.random()-.5)*shake,height/2+(Math.random()-.5)*shake);ctx.scale(zoom,zoom);ctx.translate(-camera.x,-camera.y);
    const visible=e=>Math.abs(e.x-camera.x)<width/(2*zoom)+110&&Math.abs(e.y-camera.y)<height/(2*zoom)+110;
    for(const hazard of s.hazards||[])drawHazard(hazard,t);
    for(const obstacle of s.obstacles||[]){if(!visible(obstacle))continue;const foundry=s.arena==='foundry';polygon(obstacle.x,obstacle.y,obstacle.r+7,foundry?8:6,.5);ctx.fillStyle=foundry?'#302426':'#0e1d22';ctx.fill();ctx.strokeStyle=foundry?'#a86641':'#477168';ctx.lineWidth=2;ctx.stroke();polygon(obstacle.x,obstacle.y,obstacle.r-4,foundry?8:6,.5);ctx.strokeStyle=foundry?'#de8b5055':'#45635566';ctx.lineWidth=1;ctx.stroke();line(obstacle.x-7,obstacle.y,obstacle.x+7,obstacle.y,foundry?'#e9ad6766':'#7a89774d',2);}
    for(const gem of s.gems||[]){if(!visible(gem))continue;ctx.fillStyle=(gem.value||1)>4?C.lime:C.mint;polygon(gem.x,gem.y,gem.r||4,4,0);ctx.fill();}
    for(const heal of s.pickups||[]){if(!visible(heal))continue;ring(heal.x,heal.y,13+Math.sin(t*4)*2,'#c6f78480');ctx.fillStyle=C.lime;ctx.fillRect(heal.x-3,heal.y-8,6,16);ctx.fillRect(heal.x-8,heal.y-3,16,6);}
    // Telegraphs sit beneath actors so danger remains legible amid effects.
    for(const e of s.enemies||[]){if(e.windup>0){ring(e.x,e.y,e.r+15+(Math.sin(t*12)+1)*6,'#ff9c6999',2);line(e.x,e.y,e.x+Math.cos(e.angle)*220,e.y+Math.sin(e.angle)*220,'#ff9c6944',2);}}
    for(const enemy of s.enemies||[]){if(visible(enemy))drawEnemy(enemy,t);}
    for(const bullet of s.bullets||[]){if(!visible(bullet))continue;const angle=Math.atan2(bullet.vy,bullet.vx);line(bullet.x-Math.cos(angle)*19,bullet.y-Math.sin(angle)*19,bullet.x,bullet.y,(s.upgrades.multishot||0)>0?'#ffcb88':C.lime,3.2);circle(bullet.x,bullet.y,(bullet.r||3)+.6,'#f2ffd7');}
    for(const bullet of s.hostileBullets||[]){if(!visible(bullet))continue;circle(bullet.x,bullet.y,(bullet.r||5)+3,'#ff724523');circle(bullet.x,bullet.y,bullet.r||5,C.orange);circle(bullet.x,bullet.y,2,'#fff3b2');}
    const orbit=p.stats.orbit||0;if(orbit){ring(p.x,p.y,78,'#6af0c42b');for(let i=0;i<orbit;i++){const a=s.time*2.6+i*Math.PI*2/orbit,x=p.x+Math.cos(a)*78,y=p.y+Math.sin(a)*78;ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.fillStyle='#99ffe6';ctx.beginPath();ctx.moveTo(14,0);ctx.lineTo(-7,-7);ctx.lineTo(-3,0);ctx.lineTo(-7,7);ctx.closePath();ctx.fill();ctx.restore();}}
    drawPlayer(p,t,s);
    for(const effect of s.effects||[]){if(visible(effect)||effect.type==='line')drawEffect(effect);}
    if(aimHeld){ring(pointerWorld.x,pointerWorld.y,12,'#c6f78480');line(pointerWorld.x-17,pointerWorld.y,pointerWorld.x-8,pointerWorld.y,C.lime);line(pointerWorld.x+8,pointerWorld.y,pointerWorld.x+17,pointerWorld.y,C.lime);}
    ctx.restore();
    if(p.hp/p.maxHp<.3&&!reducedMotion){const danger=ctx.createRadialGradient(width/2,height/2,height*.25,width/2,height/2,Math.max(width,height)*.7);danger.addColorStop(0,'#ff402000');danger.addColorStop(1,'#cf383547');ctx.fillStyle=danger;ctx.fillRect(0,0,width,height);}
    // Off-screen boss marker helps small screens find the objective.
    if(s.boss&&s.boss.hp>0&&!visible(s.boss)){const a=Math.atan2(s.boss.y-p.y,s.boss.x-p.x),rx=width*.4,ry=height*.32;const x=width/2+Math.cos(a)*rx,y=height/2+Math.sin(a)*ry;polygon(x,y,9,3,a);ctx.fillStyle=C.orange;ctx.fill();ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText('核心',x,y+24);}
  }
  function drawHazard(h,t){
    const warning=h.phase==='warning',alpha=warning?.13:.48;
    ctx.fillStyle=`rgba(255,${h.type==='vent'?106:168},77,${alpha})`;ctx.strokeStyle=warning?'#ffbc6bdd':'#fff0bd';ctx.lineWidth=warning?2:3;
    if(h.type==='lane'){ctx.fillRect(h.x-h.w/2,h.y-h.h/2,h.w,h.h);ctx.strokeRect(h.x-h.w/2,h.y-h.h/2,h.w,h.h);if(!warning){const a=h.w>h.h;line(h.x-(a?h.w/2:0),h.y-(a?0:h.h/2),h.x+(a?h.w/2:0),h.y+(a?0:h.h/2),'#fff6b8',5);}}
    else{ctx.beginPath();ctx.arc(h.x,h.y,h.r,0,Math.PI*2);ctx.fill();ctx.stroke();if(warning){ring(h.x,h.y,h.r*clamp(1-h.life/h.maxLife,.1,1),'#ffce8f99',2);}else{ring(h.x,h.y,h.r*.6,'#ffd4a1',3);}}
    ctx.fillStyle=warning?'#ffd5a2':'#fff4d5';ctx.font='bold 11px sans-serif';ctx.textAlign='center';const y=clamp(h.y,camera.y-height/(2*zoom)+210,camera.y+height/(2*zoom)-140);ctx.fillText(warning?(h.type==='vent'?'喷火预警':'电击预警'):'危险',clamp(h.x,camera.x-width/(2*zoom)+80,camera.x+width/(2*zoom)-80),y-10);
  }
  function drawEnemy(e,t){
    const color=e.type==='runner'?C.orange:e.type==='tank'?'#b19add':e.type==='shooter'?'#f0b86b':e.type==='elite'?C.red:e.type==='boss'?'#ff8368':'#f29c8f';
    const angle=e.angle||Math.atan2(game.state.player.y-e.y,game.state.player.x-e.x);
    circle(e.x+2,e.y+6,e.r+2,'#00000030');
    if(e.type==='boss'){ring(e.x,e.y,e.r+11,'#ff9c693b',2);polygon(e.x,e.y,e.r+5,6,t*.22);ctx.strokeStyle=C.orange;ctx.lineWidth=2;ctx.stroke();}
    ctx.save();ctx.translate(e.x,e.y);ctx.rotate(angle);
    const sides=e.type==='runner'?3:e.type==='tank'?6:e.type==='shooter'?4:e.type==='boss'?6:5;
    polygon(0,0,e.r,sides,0);ctx.fillStyle=e.flash>0?'#fff3cf':e.type==='tank'?'#40334d':e.type==='boss'?'#592e29':'#3b2c30';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=e.type==='boss'?3:1.4;ctx.stroke();
    if(e.type==='shooter'){ctx.fillStyle=color;ctx.fillRect(e.r-3,-3,10,6);}
    polygon(1,0,e.r*.35,e.type==='boss'?3:4,0);ctx.fillStyle=color;ctx.fill();
    if(e.type==='elite'||e.type==='boss'){line(-e.r*.6,-e.r*.6,e.r*.6,e.r*.6,'#ffb27980',1);line(e.r*.6,-e.r*.6,-e.r*.6,e.r*.6,'#ffb27980',1);}
    ctx.restore();
    if(e.hp<e.maxHp&&(e.type==='elite'||e.type==='tank')){ctx.fillStyle='#071317';ctx.fillRect(e.x-e.r,e.y-e.r-9,e.r*2,3);ctx.fillStyle=color;ctx.fillRect(e.x-e.r,e.y-e.r-9,e.r*2*clamp(e.hp/e.maxHp,0,1),3);}
    if(e.slowTime>0)ring(e.x,e.y,e.r+4,'#8cdfed6e');
  }
  function drawPlayer(p,t,s){
    let target=null,d=Infinity;for(const enemy of s.enemies||[]){const distance=(enemy.x-p.x)**2+(enemy.y-p.y)**2;if(distance<d){d=distance;target=enemy;}}
    const angle=aimHeld?Math.atan2(pointerWorld.y-p.y,pointerWorld.x-p.x):target?Math.atan2(target.y-p.y,target.x-p.x):t*.1;
    const trailColor=progress.trails.find(t=>t.id===progress.selectedTrail)?.color||C.mint;
    if(p.dashTime>0){ring(p.x,p.y,40,trailColor+'88',3);circle(p.x,p.y,27,trailColor+'33');for(let i=1;i<=4;i++){ctx.globalAlpha=(1-i/5)*.65;polygon(p.x-p.dashX*i*13,p.y-p.dashY*i*13,p.r*(1-i*.1),4,angle);ctx.fillStyle=trailColor;ctx.fill();}ctx.globalAlpha=1;}
    const invuln=p.invuln>0;ctx.globalAlpha=invuln&&!reducedMotion?.55+.45*Math.abs(Math.sin(t*18)):1;
    ring(p.x,p.y,p.r+7,invuln?'#c6f784dd':'#94d6ac66',1.5);
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);polygon(0,0,p.r,4,0);ctx.fillStyle='#213d32';ctx.fill();ctx.strokeStyle=C.lime;ctx.lineWidth=2;ctx.stroke();polygon(2,0,p.r*.48,4,0);ctx.fillStyle='#e6ffa8';ctx.fill();line(p.r+2,0,p.r+11,0,C.lime,3);ctx.restore();ctx.globalAlpha=1;
  }
  function drawEffect(e){
    const alpha=clamp(e.life/(e.maxLife||.5),0,1);ctx.globalAlpha=alpha;const color=e.color||C.mint;
    if(e.type==='line'){const trail=e.width>=10;const actualColor=trail?(progress.trails.find(t=>t.id===progress.selectedTrail)?.color||color):color;line(e.x,e.y,e.x2??e.x,e.y2??e.y,actualColor,e.width||2.7);if(!reducedMotion&&!trail){line(e.x+2,e.y+1,(e.x2??e.x)-2,(e.y2??e.y)+3,'#e1ffe580',1);}}
    else if(e.type==='ring'){ring(e.x,e.y,e.r||20,color,e.vortex?3:2);if(e.vortex){ring(e.x,e.y,(e.r||20)*.55,color,1);}}
    else if(e.type==='text'){ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(e.text||'',e.x,e.y);}
    else {circle(e.x,e.y,Math.max(1,e.r||2),color);}
    ctx.globalAlpha=1;
  }
  let uiTimer=0;
  function frame(timestamp){
    const raw=lastTime?(timestamp-lastTime)/1000:0;lastTime=timestamp;
    const dt=Math.min(raw,.05);frameStats.frames++;frameStats.elapsed+=raw;frameStats.maxFrame=Math.max(frameStats.maxFrame,raw);
    if(frameStats.elapsed>=1){frameStats.fps=Math.round(frameStats.frames/frameStats.elapsed);frameStats.elapsed=0;frameStats.frames=0;}
    if(game.state.mode==='playing'){
      let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+stick.x;
      let y=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+stick.y;
      const input={x,y,dash:dashQueued};dashQueued=false;
      if(aimHeld){pointerWorld.x=camera.x+(pointerScreen.x-width/2)/zoom;pointerWorld.y=camera.y+(pointerScreen.y-height/2)/zoom;input.aimX=pointerWorld.x;input.aimY=pointerWorld.y;}
      if(hitStopRemaining>0&&!reducedMotion){hitStopRemaining=Math.max(0,hitStopRemaining-dt);if(input.dash)dashQueued=true;}
      else game.update(dt,input);
      if(game.state.hitStop>0){if(!reducedMotion)hitStopRemaining=Math.max(hitStopRemaining,game.state.hitStop);game.state.hitStop=0;}
    }
    consumeAudio();uiTimer+=dt;if(uiTimer>.08||previousMode!==game.state.mode){syncUI();uiTimer=0;}
    if(game.state.mode==='menu')drawMenu(timestamp/1000);else drawWorld(timestamp/1000);
    requestAnimationFrame(frame);
  }
  // Read-only diagnostics: useful for QA, no cheat or privileged control surface.
  Object.defineProperty(window,'emberDiagnostics',{get:()=>({mode:game.state.mode,time:game.state.time,player:{...game.state.player},kills:game.state.kills,upgrades:{...game.state.upgrades},entities:{enemies:game.state.enemies.length,bullets:game.state.bullets.length,effects:game.state.effects.length},fps:frameStats.fps,maxFrameMs:Math.round(frameStats.maxFrame*1000),errors:errors.slice(),touch:touchMode,viewport:{width,height,zoom},choices:game.state.choices?.map(c=>c.id)})});
  syncArenas();renderProgress();syncUI();requestAnimationFrame(frame);
})();

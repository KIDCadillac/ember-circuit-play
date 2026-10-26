(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmberCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Balance knobs: six minutes of survival, followed by a two-minute boss window.
  // Entities are capped independently to keep an upgraded late run responsive.
  const LIMITS = Object.freeze({ enemies: 150, bullets: 180, hostileBullets: 200, gems: 220, pickups: 20, effects: 260, events: 64, hazards: 12 });
  const BALANCE = Object.freeze({ duration: 360, deadline: 480, speed: 240, hp: 100, damage: 18, fireRate: 2.8, dashSpeed: 900, dashTime: .18, dashCooldown: 2.4, hurtInvulnerability: .75 });
  const UPGRADES = [
    { id: 'power', name: '炽热弹芯', tag: 'POWER', description: '弹丸伤害 +22%', maxLevel: 5 },
    { id: 'haste', name: '高速循环', tag: 'TEMPO', description: '射击速度 +16%', maxLevel: 5 },
    { id: 'multishot', name: '散射贯穿', tag: 'SPLIT', description: '三发扇形弹幕，每发贯穿 1 敌；再次升级变为五发', maxLevel: 2 },
    { id: 'pierce', name: '贯穿协议', tag: 'PIERCE', description: '弹丸额外贯穿 1 个敌人', maxLevel: 3 },
    { id: 'chain', name: '连锁闪电', tag: 'CHAIN', description: '命中后跳跃 3 个目标；每次升级再增加 1 次跳跃', maxLevel: 3 },
    { id: 'nova', name: '引力爆裂', tag: 'NOVA', description: '击杀爆炸并产生 0.6 秒引力涡流，牵引敌人与经验', maxLevel: 3 },
    { id: 'frost', name: '冷却脉冲', tag: 'SLOW', description: '命中使目标减速，强化减速效果', maxLevel: 3 },
    { id: 'speed', name: '轻量推进', tag: 'MOVE', description: '移动速度 +9%', maxLevel: 3 },
    { id: 'vitality', name: '备用电池', tag: 'VITAL', description: '生命上限 +25，并恢复 25 生命', maxLevel: 4 },
    { id: 'magnet', name: '引力线圈', tag: 'PULL', description: '经验吸附范围 +45', maxLevel: 3 },
    { id: 'siphon', name: '生命回收', tag: 'SIPHON', description: '每击杀 20 个敌人恢复 4 生命', maxLevel: 3 },
    { id: 'dash', name: '闪烁引擎', tag: 'DASH', description: '冲刺冷却 -15%，冲撞伤害 +25', maxLevel: 3 },
    { id: 'orbit', name: '环绕刀刃', tag: 'ORBIT', description: '三枚环绕刀刃持续切割；每次升级增加一枚', maxLevel: 3 },
    { id: 'regen', name: '自愈回路', tag: 'REPAIR', description: '每秒恢复 0.35 生命', maxLevel: 3 },
    { id: 'crit', name: '过载火花', tag: 'CRIT', description: '暴击概率 +10%，造成双倍伤害', maxLevel: 4 },
    { id: 'armor', name: '复合装甲', tag: 'GUARD', description: '受到伤害降低 10%', maxLevel: 3 }
  ].map(Object.freeze);
  const ENEMY = {
    drone: { r: 13, hp: 26, speed: 76, damage: 12, xp: 4, color: '#ff795b' },
    runner: { r: 10, hp: 18, speed: 185, damage: 10, xp: 5, color: '#ffc675' },
    tank: { r: 24, hp: 115, speed: 46, damage: 24, xp: 14, color: '#c986ee' },
    shooter: { r: 16, hp: 48, speed: 62, damage: 12, xp: 10, color: '#ff8db7' },
    elite: { r: 33, hp: 440, speed: 67, damage: 22, xp: 65, color: '#e9a8ff' },
    boss: { r: 54, hp: 3900, speed: 58, damage: 28, xp: 300, color: '#ffbe69' }
  };
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const length = (x, y) => Math.hypot(x, y);
  const finite = value => Number.isFinite(value);
  const distance = (a, b) => length(a.x-b.x, a.y-b.y);
  const angleTo = (a, b) => Math.atan2(b.y-a.y, b.x-a.x);
  function sweepHitTime(x1,y1,x2,y2,target,radius) {
    const dx=x2-x1,dy=y2-y1,ox=x1-target.x,oy=y1-target.y,a=dx*dx+dy*dy;
    const c=ox*ox+oy*oy-radius*radius;
    if(c<=0)return 0;
    if(a<=0)return Infinity;
    const b=2*(ox*dx+oy*dy),discriminant=b*b-4*a*c;
    if(discriminant<0)return Infinity;
    const t=(-b-Math.sqrt(discriminant))/(2*a);
    return t>=0&&t<=1?t:Infinity;
  }

  function createGame(options) {
    options = options || {};
    let initialSeed = Number(options.seed);
    if (!finite(initialSeed)) initialSeed = Date.now();
    initialSeed = initialSeed >>> 0;
    let selectedArena=options.arena==='foundry'?'foundry':'conduit';
    let randomState = initialSeed, nextId = 1, state;
    let dashHeld = false, dashActiveThisFrame = false, dashHits = new Set(), deathQueue = [], dashStart={x:0,y:0};
    function random() {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    }
    function emit(name) {
      if(state.events.length>=LIMITS.events) {
        if(!['win','lose','level','select','elite','hurt','dash','heavy'].includes(name))return;
        state.events.shift();
      }
      state.events.push(name);
    }
    function effect(type, x, y, props) {
      const item = Object.assign({ type, x, y, life: .35, maxLife: .35 }, props);
      item.maxLife = item.life;
      if (state.effects.length >= LIMITS.effects) state.effects.shift();
      state.effects.push(item);
    }
    function burst(x, y, color, count) {
      for (let i=0;i<count;i++) {
        const a=random()*Math.PI*2, speed=40+random()*120;
        effect('particle',x,y,{vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,r:2+random()*2,color,life:.2+random()*.24});
      }
    }
    function notice(text, duration) { state.eventText=text;state.eventTimer=duration || 3; }
    function baseStats() {
      return { damage: BALANCE.damage, fireRate: BALANCE.fireRate, projectiles: 1, pierce: 0, chain: 0, explosion: 0, slow: 0, magnet: 95, regen: 0, armor: 0, crit: .05, orbit: 0, siphon: 0, dashCooldown: BALANCE.dashCooldown };
    }
    function arenaObstacles() {
      const coords=selectedArena==='foundry'
        ? [[840,630,83],[1160,550,65],[1530,650,83],[800,1060,80],[1160,1200,68],[1520,1130,86],[470,820,62],[1900,900,62],[640,1430,63],[1780,390,63]]
        : [[640,510,47],[1760,510,47],[640,1290,47],[1760,1290,47],[1200,370,36],[1200,1430,36],[360,900,36],[2040,900,36]];
      return coords.map(([x,y,r])=>({x,y,r}));
    }
    function reset() {
      randomState=initialSeed;nextId=1;dashHeld=false;dashActiveThisFrame=false;dashHits=new Set();deathQueue=[];
      state = {
        mode:'menu',time:0,duration:BALANCE.duration,deadline:BALANCE.deadline,seed:initialSeed,
        world:{w:2400,h:1800},arena:selectedArena,wave:1,wavePhase:'assault',waveRemaining:23,
        player:{x:1200,y:900,r:15,hp:BALANCE.hp,maxHp:BALANCE.hp,speed:BALANCE.speed,invuln:0,dashTime:0,dashCooldown:0,level:1,xp:0,xpNext:24,angle:0,lastX:1,lastY:0,dashX:1,dashY:0,stats:baseStats()},
        enemies:[],bullets:[],hostileBullets:[],gems:[],pickups:[],effects:[],events:[],choices:[],upgrades:{},hazards:[],
        obstacles:arenaObstacles(),
        kills:0,dashKills:0,highestChain:0,combo:0,maxCombo:0,comboTimer:0,score:0,boss:null,bossSpawned:false,eliteIndex:0,
        shake:0,hitStop:0,heavyCooldown:0,eventText:'第一波 · 冲刺撞击可直接击破无人机',eventTimer:5,spawnTimer:.55,hazardTimer:10,fireTimer:0,pendingLevels:0,upgradeSelections:0,buildName:'基础回路',endReason:''
      };
    }
    function start() {
      if(state.mode!=='menu') return false;
      state.mode='playing';
      for(let i=0;i<4;i++) spawnAtEdge('drone',320+i*25);
      return true;
    }
    function setArena(arena) {
      if(state.mode!=='menu'||!['conduit','foundry'].includes(arena))return false;
      selectedArena=arena;reset();return true;
    }
    function restart(config) { if(config&&['conduit','foundry'].includes(config.arena))selectedArena=config.arena;reset();start();return state; }
    function togglePause() {
      if(state.mode==='playing'){state.mode='paused';dashHeld=false;return true;}
      if(state.mode==='paused'){state.mode='playing';return true;}
      return false;
    }
    function finish(mode, reason) {
      if(state.mode!=='playing') return;
      state.mode=mode;state.endReason=reason;state.choices=[];
      state.score+=Math.round(state.time*2+state.maxCombo*5+(mode==='won'?5000:0));
      emit(mode==='won'?'win':'lose');
      notice(reason,9);
      effect('ring',state.player.x,state.player.y,{r:180,color:mode==='won'?'#91ffdc':'#ff655e',life:1.2});
    }
    function hurtPlayer(amount) {
      const p=state.player;
      if(state.mode!=='playing' || !finite(amount) || amount<=0 || p.invuln>0 || p.dashTime>0) return false;
      const damage=amount*(1-p.stats.armor);
      p.hp=Math.max(0,p.hp-damage);p.invuln=BALANCE.hurtInvulnerability;
      state.shake=Math.max(state.shake,8);state.combo=0;state.comboTimer=0;
      effect('text',p.x,p.y-28,{text:'−'+Math.ceil(damage),color:'#ff8176',life:.65});
      burst(p.x,p.y,'#ff8176',9);emit('hurt');
      if(p.hp<=0) finish('dead','回路熄灭');
      return true;
    }
    function separateFromObstacles(entity) {
      for(let pass=0;pass<2;pass++) for(const o of state.obstacles) {
        const dx=entity.x-o.x,dy=entity.y-o.y,d=length(dx,dy),minimum=entity.r+o.r;
        if(d<minimum) {
          const nx=d>.001?dx/d:1,ny=d>.001?dy/d:0;
          entity.x=o.x+nx*minimum;entity.y=o.y+ny*minimum;
        }
      }
      entity.x=clamp(entity.x,entity.r,state.world.w-entity.r);
      entity.y=clamp(entity.y,entity.r,state.world.h-entity.r);
    }
    function spawnEnemy(type,x,y) {
      const template=ENEMY[type];
      if(!template || !finite(x) || !finite(y)) return null;
      if(state.enemies.length>=LIMITS.enemies) {
        if(type!=='boss'&&type!=='elite') return null;
        const i=state.enemies.findIndex(e=>e.type!=='boss'&&e.type!=='elite');
        if(i<0) return null;
        state.enemies.splice(i,1);
      }
      const scale=type==='boss'?1:1+state.time*.0036;
      const e={id:nextId++,type,x,y,r:template.r,hp:template.hp*scale,maxHp:template.hp*scale,speed:template.speed*(1+Math.min(state.time,360)*.00065),damage:template.damage,xp:template.xp,color:template.color,flash:0,angle:0,kx:0,ky:0,slowTime:0,orbitTimer:0,attackTimer:1.1+random(),phase:0,windup:0,dead:false};
      separateFromObstacles(e);state.enemies.push(e);
      if(type==='boss') state.boss=e;
      return e;
    }
    function spawnAtEdge(type, radius) {
      const p=state.player;
      let x,y;
      const minimum=radius?280:350;
      for(let i=0;i<12;i++) {
        const a=random()*Math.PI*2,r=radius || 430+random()*130;
        x=clamp(p.x+Math.cos(a)*r,45,state.world.w-45);
        y=clamp(p.y+Math.sin(a)*r,45,state.world.h-45);
        if(length(x-p.x,y-p.y)>minimum) break;
      }
      // At a corner, twelve outward rolls can all clamp to the same near point.
      // A centerward fallback has room for the whole spawn radius.
      if(length(x-p.x,y-p.y)<=minimum) {
        const a=Math.atan2(state.world.h/2-p.y,state.world.w/2-p.x),r=radius||490;
        x=p.x+Math.cos(a)*r;y=p.y+Math.sin(a)*r;
      }
      return spawnEnemy(type,x,y);
    }
    function heal(amount) {
      const p=state.player,old=p.hp;p.hp=Math.min(p.maxHp,p.hp+amount);
      if(p.hp>old)effect('text',p.x,p.y-30,{text:'+'+Math.ceil(p.hp-old),color:'#8affc9',life:.7});
    }
    function addGem(x,y,value) {
      if(state.gems.length<LIMITS.gems)state.gems.push({x,y,r:value>=30?8:5,value,age:0});
      else {
        let nearest=state.gems[0],d=Infinity;
        for(const gem of state.gems){const next=length(gem.x-x,gem.y-y);if(next<d){d=next;nearest=gem;}}
        nearest.value+=value;nearest.r=Math.min(10,5+Math.sqrt(nearest.value)*.2);
      }
    }
    function heavyImpact(x,y) {
      if(state.heavyCooldown>0)return;
      state.heavyCooldown=.18;state.hitStop=Math.max(state.hitStop,.035);state.shake=Math.max(state.shake,5);
      effect('ring',x,y,{r:48,color:'#ffffff',life:.18});emit('heavy');
    }
    function damageEnemy(e,amount,source) {
      if(!e || e.dead || e.hp<=0 || amount<=0)return;
      e.hp=Math.max(0,e.hp-amount);e.flash=.06;
      if(source) {
        const d=length(source.x,source.y)||1,force=source.force||85;
        e.kx+=source.x/d*force;e.ky+=source.y/d*force;
        if(source.kind==='dash'&&e.hp===0)e.dashKill=true;
      }
      if(state.player.stats.slow)e.slowTime=1.2;
      if(e.hp===0){e.dead=true;deathQueue.push(e);}
    }
    function processDeaths() {
      // An explicit queue permits long explosion cascades without recursion.
      let processed=0;
      while(deathQueue.length && processed++<=LIMITS.enemies) {
        const e=deathQueue.shift();
        state.kills++;if(e.dashKill)state.dashKills++;
        state.combo++;state.maxCombo=Math.max(state.maxCombo,state.combo);state.comboTimer=2.6;
        state.score+=10+Math.min(state.combo,50);emit('kill');addGem(e.x,e.y,e.xp);
        burst(e.x,e.y,e.color,e.type==='drone'?4:8);
        if(['tank','elite','boss'].includes(e.type))heavyImpact(e.x,e.y);
        if(e.type==='elite') {
          if(state.pickups.length<LIMITS.pickups)state.pickups.push({x:e.x,y:e.y,r:11,type:'health',value:35});
          notice('精英已击破 · 拾取能量核心',3);state.shake=Math.max(state.shake,6);
        } else if(e.type!=='boss' && random()<.035 && state.pickups.length<LIMITS.pickups)state.pickups.push({x:e.x,y:e.y,r:9,type:'health',value:18});
        const siphon=state.player.stats.siphon;
        if(siphon&&state.kills%20===0)heal(4*siphon);
        if(e.type==='boss'){finish('won','回路重燃 · 核心已净化');continue;}
        const nova=state.player.stats.explosion;
        if(nova) {
          const radius=65+nova*20;
          effect('ring',e.x,e.y,{r:radius,color:'#ffb95e',life:.32});
          effect('ring',e.x,e.y,{r:155+nova*20,color:'#c7a4ff',life:.6,vortex:true,strength:120+nova*35});
          for(const target of state.enemies)if(!target.dead&&distance(e,target)<radius+target.r)damageEnemy(target,state.player.stats.damage*(.5+nova*.2));
        }
      }
      state.enemies=state.enemies.filter(e=>!e.dead);
    }
    function arcFrom(first,damage) {
      const count=state.player.stats.chain;
      if(!count)return;
      let previous=first,power=damage*.7;
      const hit=new Set([first.id]);
      for(let i=0;i<count;i++) {
        let next=null,best=180;
        for(const e of state.enemies)if(!e.dead&&!hit.has(e.id)){const d=distance(previous,e);if(d<best){best=d;next=e;}}
        if(!next)break;
        hit.add(next.id);damageEnemy(next,power,{x:next.x-previous.x,y:next.y-previous.y,force:55});
        effect('line',previous.x,previous.y,{x2:next.x,y2:next.y,color:'#a9f8ff',life:.15});
        previous=next;power*=.78;emit('chain');
      }
      state.highestChain=Math.max(state.highestChain,hit.size);
    }
    function showUpgrade() {
      if(state.mode!=='playing')return;
      const early=state.upgradeSelections<2;
      const ids=state.upgradeSelections===0?['chain','multishot','orbit']:['chain','multishot','orbit','nova'].filter(id=>!state.upgrades[id]);
      const available=(early?ids.map(id=>UPGRADES.find(u=>u.id===id)):UPGRADES.filter(u=>(state.upgrades[u.id]||0)<u.maxLevel)).slice();
      if(!available.length){state.pendingLevels=0;heal(20);return;}
      state.mode='upgrade';state.choices=[];
      for(let i=0;i<3&&available.length;i++) {
        const index=early?0:Math.floor(random()*available.length),u=available.splice(index,1)[0],level=state.upgrades[u.id]||0;
        const details={chain:level?'增加 1 次跳跃，总计 '+(3+level)+' 个额外目标':'命中后连锁跳跃 3 个额外目标',multishot:level?'扇形弹幕增加至 5 发，每发贯穿 1 敌':'三发扇形弹幕，每发贯穿 1 个额外目标',orbit:level?'环绕刀刃增加至 '+(3+level)+' 枚':'生成 3 枚环绕刀刃，近身持续切割'};
        state.choices.push(Object.assign({},u,{level,description:details[u.id]||u.description}));
      }
      emit('level');
    }
    function gainXp(value) {
      const p=state.player;p.xp+=value;
      while(p.xp>=p.xpNext) {
        p.xp-=p.xpNext;p.level++;p.xpNext=Math.round(50+22*Math.pow(p.level,1.65));state.pendingLevels++;
      }
    }
    function recomputeStats() {
      const p=state.player,u=state.upgrades,n=id=>u[id]||0,s=baseStats();
      s.damage=BALANCE.damage*(1+.22*n('power'));
      s.fireRate=BALANCE.fireRate*(1+.16*n('haste'));
      s.projectiles=1+2*n('multishot');s.pierce=n('pierce')+(n('multishot')?1:0);s.chain=n('chain')?2+n('chain'):0;s.explosion=n('nova');
      s.slow=n('frost')*.15;s.magnet=95+45*n('magnet');s.regen=.35*n('regen');
      s.armor=.1*n('armor');s.crit=.05+.1*n('crit');s.orbit=n('orbit')?2+n('orbit'):0;s.siphon=n('siphon');
      s.dashCooldown=BALANCE.dashCooldown*(1-.15*n('dash'));
      p.stats=s;p.speed=BALANCE.speed*(1+.09*n('speed'));p.maxHp=BALANCE.hp+25*n('vitality');
      state.buildName=[n('chain')?'连锁闪电':'',n('multishot')?'散射贯穿':'',n('orbit')?'环绕刀刃':'',n('nova')?'引力爆裂':''].filter(Boolean).join(' · ')||'基础回路';
    }
    function chooseUpgrade(index) {
      if(state.mode!=='upgrade'||!Number.isInteger(index)||!state.choices[index])return false;
      const choice=state.choices[index],u=UPGRADES.find(u=>u.id===choice.id);
      if(!u||(state.upgrades[u.id]||0)>=u.maxLevel)return false;
      state.upgrades[u.id]=(state.upgrades[u.id]||0)+1;state.upgradeSelections++;recomputeStats();
      if(u.id==='vitality')heal(25);
      state.pendingLevels=Math.max(0,state.pendingLevels-1);state.choices=[];state.mode='playing';dashHeld=false;
      emit('select');notice(u.name+' · 回路已升级',2);return true;
    }
    function advanceSpawning(dt) {
      while(state.eliteIndex<3&&state.time>=90*(state.eliteIndex+1)) {
        state.eliteIndex++;spawnAtEdge('elite',590);emit('elite');notice('精英信号 · 保持机动',4);
      }
      if(state.time>=BALANCE.duration&&!state.bossSpawned) {
        state.bossSpawned=true;spawnAtEdge('boss',590);emit('elite');notice('焚核守卫已苏醒 · 摧毁核心',5);state.shake=9;
      }
      if(state.wavePhase==='recovery')return;
      state.spawnTimer-=dt;
      if(state.spawnTimer<=0) {
        // Population ramps steadily; regular health grows more gently than firepower.
        state.spawnTimer=Math.max(.19,.72-state.time*.0016)*(state.bossSpawned?1.65:1);
        const roll=random(),t=state.time;
        let type='drone';
        if(t>8&&roll<.24)type='runner';
        else if(t>40&&roll<.38)type='shooter';
        else if(t>80&&roll<.49)type='tank';
        spawnAtEdge(type);
        if(t>210&&random()<.28)spawnAtEdge('drone');
      }
    }
    function updateWave() {
      const wave=1+Math.floor((state.time+1e-8)/30),elapsed=(state.time+1e-8)%30,phase=elapsed<23?'assault':'recovery';
      if(wave!==state.wave||phase!==state.wavePhase) {
        if(phase==='recovery') {
          notice('休整 7 秒 · 回收附近能量，准备下一波',3);
          for(const gem of state.gems)if(distance(gem,state.player)<420)gem.pulling=true;
        } else notice('第 '+wave+' 波 · 新一轮突袭',2.5);
      }
      state.wave=wave;state.wavePhase=phase;state.waveRemaining=Math.max(0,(phase==='assault'?23:30)-elapsed);
    }
    function updateHazards(dt) {
      const p=state.player;
      for(const h of state.hazards) {
        h.life-=dt;
        if(h.phase==='warning'&&h.life<=0) {
          h.phase='active';h.maxLife=.65;h.life+=.65;emit('hazard');
        }
        if(h.phase!=='active'||h.life<=0||h.hit)continue;
        const contact=h.type==='lane'
          ? Math.abs(p.x-h.x)<h.w/2+p.r&&Math.abs(p.y-h.y)<h.h/2+p.r
          : distance(p,h)<h.r+p.r;
        if(contact&&hurtPlayer(h.damage||16))h.hit=true;
      }
      state.hazards=state.hazards.filter(h=>h.life>0);
      state.hazardTimer-=dt;
      if(state.hazardTimer>0||state.wavePhase==='recovery')return;
      state.hazardTimer=Math.max(5.8,10-state.time*.01);
      const count=state.time>150?2:1;
      for(let i=0;i<count&&state.hazards.length<LIMITS.hazards;i++) {
        const warning=state.arena==='foundry'?1.65:1.5;
        const h={x:clamp(p.x+(i?random()*300-150:0),180,state.world.w-180),y:clamp(p.y+(i?random()*300-150:0),180,state.world.h-180),phase:'warning',life:warning,maxLife:warning,damage:16};
        if(state.arena==='conduit') {
          const vertical=random()<.5;h.type='lane';h.w=vertical?115:1000;h.h=vertical?850:115;
          h.x=clamp(h.x,h.w/2+20,state.world.w-h.w/2-20);h.y=clamp(h.y,h.h/2+20,state.world.h-h.h/2-20);
        } else {h.type='vent';h.r=100+Math.min(25,state.time*.05);}
        state.hazards.push(h);
      }
    }
    function updateVortices(dt) {
      for(const vortex of state.effects)if(vortex.vortex&&vortex.life>0) {
        for(const item of [...state.enemies,...state.gems]) {
          if(item.dead||item.type==='boss')continue;
          const dx=vortex.x-item.x,dy=vortex.y-item.y,d=length(dx,dy);
          if(d<1||d>vortex.r)continue;
          const step=Math.min(d,vortex.strength*dt);
          item.x+=dx/d*step;item.y+=dy/d*step;
          if(item.id)separateFromObstacles(item);
        }
      }
    }
    function movePlayer(dt,input) {
      const p=state.player;
      p.invuln=Math.max(0,p.invuln-dt);p.dashCooldown=Math.max(0,p.dashCooldown-dt);
      const rawX=finite(input.x)?input.x:0,rawY=finite(input.y)?input.y:0,len=length(rawX,rawY);
      const x=len>1?rawX/len:rawX,y=len>1?rawY/len:rawY;
      if(len>.01){p.lastX=x/Math.max(length(x,y),.001);p.lastY=y/Math.max(length(x,y),.001);}
      if(input.dash&&!dashHeld&&p.dashCooldown<=0) {
        p.dashTime=BALANCE.dashTime;p.invuln=Math.max(p.invuln,.25);p.dashCooldown=p.stats.dashCooldown;
        p.dashX=p.lastX;p.dashY=p.lastY;dashHits.clear();emit('dash');
        effect('ring',p.x,p.y,{r:55,color:'#8cffdf',life:.25});
      }
      dashHeld=!!input.dash;
      dashActiveThisFrame=p.dashTime>0;
      dashStart={x:p.x,y:p.y};
      if(p.dashTime>0) {
        const dashDt=Math.min(p.dashTime,dt),walkDt=dt-dashDt;
        p.x+=p.dashX*BALANCE.dashSpeed*dashDt+x*p.speed*walkDt;
        p.y+=p.dashY*BALANCE.dashSpeed*dashDt+y*p.speed*walkDt;
        p.dashTime=Math.max(0,p.dashTime-dt);
        effect('line',dashStart.x,dashStart.y,{x2:p.x,y2:p.y,color:'#7ffff0',life:.2,width:18});
        effect('particle',p.x,p.y,{r:12,color:'#7ffff0',life:.18});
      } else {p.x+=x*p.speed*dt;p.y+=y*p.speed*dt;}
      separateFromObstacles(p);
      if(p.stats.regen)p.hp=Math.min(p.maxHp,p.hp+p.stats.regen*dt);
    }
    function hostileShot(e,angle,speed,damage) {
      if(state.hostileBullets.length>=LIMITS.hostileBullets)return;
      state.hostileBullets.push({x:e.x+Math.cos(angle)*(e.r+6),y:e.y+Math.sin(angle)*(e.r+6),vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,r:e.type==='boss'?7:5,life:6,damage:damage||12,color:e.type==='boss'?'#ffb95d':'#ff709c'});
    }
    function updateEnemies(dt) {
      const p=state.player;
      for(const e of state.enemies) {
        if(e.dead)continue;
        e.flash=Math.max(0,e.flash-dt);e.slowTime=Math.max(0,e.slowTime-dt);e.orbitTimer=Math.max(0,e.orbitTimer-dt);e.attackTimer-=dt;
        const dx=p.x-e.x,dy=p.y-e.y,d=length(dx,dy),nx=d>.001?dx/d:1,ny=d>.001?dy/d:0;
        e.angle=Math.atan2(ny,nx);
        let approach=1,speed=e.speed*(e.slowTime>0?1-p.stats.slow:1);
        if(e.type==='runner') {
          if(e.attackTimer<=.45&&e.attackTimer>0&&!e.chargeTime){e.windup=.45-e.attackTimer;approach=.12;}
          if(e.attackTimer<=0&&!e.chargeTime){e.chargeTime=.32;e.chargeX=nx;e.chargeY=ny;e.attackTimer=3.2;e.windup=0;}
          if(e.chargeTime>0){e.chargeTime=Math.max(0,e.chargeTime-dt);e.kx=e.chargeX*340;e.ky=e.chargeY*340;approach=0;}
        }
        if(e.type==='shooter') {
          approach=d>330?1:d<250?-.6:0;
          if(e.attackTimer<=.55&&e.attackTimer>0)e.windup=.55-e.attackTimer;
          if(e.attackTimer<=0){hostileShot(e,e.angle,175,12);e.attackTimer=2.8;e.windup=0;}
        }
        if(e.type==='elite') {
          if(e.attackTimer<=.65&&e.attackTimer>0)e.windup=.65-e.attackTimer;
          if(e.attackTimer<=0){for(let i=-1;i<=1;i++)hostileShot(e,e.angle+i*.23,190,15);e.attackTimer=3.4;e.windup=0;}
        }
        if(e.type==='boss') {
          approach=d>280?1:.25;
          if(e.attackTimer<=.8&&e.attackTimer>0){e.windup=.8-e.attackTimer;approach=0;}
          if(e.attackTimer<=0) {
            // Alternating aimed fans and a rotating ring leave visible dodge gaps.
            const enraged=e.hp<e.maxHp*.5;
            if(e.phase%2===0)for(let i=-2;i<=2;i++)hostileShot(e,e.angle+i*.19,enraged?230:205,18);
            else for(let i=0;i<12;i++)hostileShot(e,i*Math.PI/6+e.phase*.22,155,16);
            e.phase++;e.attackTimer=enraged?1.9:2.7;e.windup=0;
          }
        }
        e.x+=(nx*speed*approach+e.kx)*dt;e.y+=(ny*speed*approach+e.ky)*dt;
        e.kx*=Math.max(0,1-dt*7);e.ky*=Math.max(0,1-dt*7);separateFromObstacles(e);
        const contact=dashActiveThisFrame?sweepHitTime(dashStart.x,dashStart.y,p.x,p.y,e,e.r+p.r+3)!==Infinity:distance(e,p)<e.r+p.r+3;
        if(contact&&dashActiveThisFrame&&!dashHits.has(e.id)) {
          dashHits.add(e.id);
          damageEnemy(e,70*(p.stats.damage/BALANCE.damage)+25*(state.upgrades.dash||0),{x:p.dashX,y:p.dashY,force:520,kind:'dash'});
          effect('ring',e.x,e.y,{r:35,color:'#9affdf',life:.2});heavyImpact(e.x,e.y);
        }else if(contact&&!dashActiveThisFrame)hurtPlayer(e.damage);
      }
      // Gentle separation prevents enemies from occupying one unreadable point.
      for(let i=0;i<state.enemies.length;i++)for(let j=i+1;j<state.enemies.length;j++) {
        const a=state.enemies[i],b=state.enemies[j];
        if(a.dead||b.dead)continue;
        const dx=b.x-a.x,dy=b.y-a.y,min=(a.r+b.r)*.83;
        if(Math.abs(dx)>min||Math.abs(dy)>min)continue;
        const d=length(dx,dy);if(d>=min)continue;
        const nx=d>.001?dx/d:(a.id%2?1:-1),ny=d>.001?dy/d:0,push=(min-d)*.24;
        a.x-=nx*push;a.y-=ny*push;b.x+=nx*push;b.y+=ny*push;
      }
      for(const e of state.enemies)separateFromObstacles(e);
    }
    function fire(dt,input) {
      state.fireTimer-=dt;
      if(state.fireTimer>0)return;
      const p=state.player;
      let angle,nearest=null,best=540;
      if(finite(input.aimX)&&finite(input.aimY)&&length(input.aimX-p.x,input.aimY-p.y)>.001)angle=Math.atan2(input.aimY-p.y,input.aimX-p.x);
      else {
        for(const e of state.enemies)if(!e.dead){const d=distance(p,e);if(d<best){best=d;nearest=e;}}
        if(!nearest){state.fireTimer=0;return;}
        angle=angleTo(p,nearest);
      }
      p.angle=angle;state.fireTimer=1/p.stats.fireRate;
      for(let i=0;i<p.stats.projectiles;i++) {
        if(state.bullets.length>=LIMITS.bullets)break;
        const a=angle+(i-(p.stats.projectiles-1)/2)*.16;
        const crit=random()<p.stats.crit;
        state.bullets.push({x:p.x+Math.cos(a)*20,y:p.y+Math.sin(a)*20,vx:Math.cos(a)*760,vy:Math.sin(a)*760,r:crit?5:4,life:1.15,damage:p.stats.damage*(crit?2:1),pierce:p.stats.pierce,hitIds:[],crit,color:crit?'#ffffff':'#95fff0'});
      }
      emit('shoot');
    }
    function updateBullets(dt) {
      for(const b of state.bullets) {
        const oldX=b.x,oldY=b.y;
        b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
        if(b.life<=0)continue;
        const hits=[];
        for(const e of state.enemies)if(!e.dead&&!b.hitIds.includes(e.id)) {
          const t=sweepHitTime(oldX,oldY,b.x,b.y,e,b.r+e.r);
          if(t!==Infinity)hits.push({e,t});
        }
        hits.sort((a,b)=>a.t-b.t);
        for(const hit of hits) {
          const e=hit.e;
          if(e.dead)continue;
          b.hitIds.push(e.id);damageEnemy(e,b.damage,{x:b.vx,y:b.vy,force:b.crit?130:85});arcFrom(e,b.damage);emit('hit');
          burst(b.x,b.y,b.color,2);
          if(b.crit){effect('text',e.x,e.y-e.r,{text:String(Math.round(b.damage)),color:'#ffffff',life:.45});emit('crit');}
          if(b.pierce--<=0){b.life=0;break;}
        }
      }
      state.bullets=state.bullets.filter(b=>b.life>0&&b.x>0&&b.y>0&&b.x<state.world.w&&b.y<state.world.h);
      for(const b of state.hostileBullets) {
        b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
        if(distance(b,state.player)<b.r+state.player.r){hurtPlayer(b.damage||12);b.life=0;}
        for(const o of state.obstacles)if(distance(b,o)<b.r+o.r)b.life=0;
      }
      state.hostileBullets=state.hostileBullets.filter(b=>b.life>0&&b.x>0&&b.y>0&&b.x<state.world.w&&b.y<state.world.h);
    }
    function updateOrbit(dt) {
      const p=state.player,n=p.stats.orbit;
      for(let i=0;i<n;i++) {
        const angle=state.time*2.6+i*Math.PI*2/n,x=p.x+Math.cos(angle)*78,y=p.y+Math.sin(angle)*78;
        for(const e of state.enemies)if(!e.dead&&e.orbitTimer<=0&&length(e.x-x,e.y-y)<e.r+12) {
          damageEnemy(e,p.stats.damage*.9,{x:e.x-p.x,y:e.y-p.y,force:90});e.orbitTimer=.3;burst(x,y,'#ffcf6b',2);emit('hit');
        }
      }
    }
    function collect(dt) {
      const p=state.player;
      for(const gem of state.gems) {
        gem.age=(gem.age||0)+dt;
        const dx=p.x-gem.x,dy=p.y-gem.y,d=length(dx,dy);
        if(d<p.stats.magnet||gem.pulling) {
          gem.pulling=true;
          const step=Math.min(d,(240+gem.age*20)*dt);
          if(d>.001){gem.x+=dx/d*step;gem.y+=dy/d*step;}
        }
        if(distance(p,gem)<p.r+gem.r+5){gainXp(gem.value);gem.value=0;}
      }
      state.gems=state.gems.filter(g=>g.value>0);
      for(const pickup of state.pickups)if(distance(p,pickup)<p.r+pickup.r+7){heal(pickup.value||20);pickup.collected=true;effect('ring',p.x,p.y,{r:45,color:'#98ffd2',life:.4});}
      state.pickups=state.pickups.filter(p=>!p.collected);
    }
    function update(dt,input) {
      if(state.mode!=='playing'||!finite(dt)||dt<=0)return;
      dt=Math.min(dt,.05);input=input||{};
      if(state.pendingLevels>0){showUpgrade();return;}
      state.time+=dt;state.shake=Math.max(0,state.shake-dt*22);state.eventTimer=Math.max(0,state.eventTimer-dt);
      state.heavyCooldown=Math.max(0,state.heavyCooldown-dt);
      state.comboTimer=Math.max(0,state.comboTimer-dt);if(!state.comboTimer)state.combo=0;
      for(const e of state.effects){e.life-=dt;if(e.vx)e.x+=e.vx*dt;if(e.vy)e.y+=e.vy*dt;}
      state.effects=state.effects.filter(e=>e.life>0);
      updateWave();advanceSpawning(dt);movePlayer(dt,input);updateHazards(dt);updateVortices(dt);updateEnemies(dt);
      if(state.mode!=='playing')return;
      fire(dt,input);updateBullets(dt);updateOrbit(dt);processDeaths();
      if(state.mode!=='playing')return;
      collect(dt);
      if(state.time>=BALANCE.deadline){finish('dead','回路过载 · 未能及时净化核心');return;}
      if(state.pendingLevels>0)showUpgrade();
    }
    reset();
    return {get state(){return state;},start,setArena,update,chooseUpgrade,togglePause,restart,hurtPlayer,spawnEnemy,snapshot:()=>JSON.parse(JSON.stringify(state))};
  }
  return Object.freeze({createGame,UPGRADES:Object.freeze(UPGRADES),LIMITS,BALANCE});
});

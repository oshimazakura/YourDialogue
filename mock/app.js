const screens=[...document.querySelectorAll('.screen')];
function go(id){screens.forEach(s=>s.classList.toggle('active',s.id===id)); closeOverlays(); document.getElementById('sessionDrawer')?.classList.remove('open');}
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
const drawer=document.getElementById('sessionDrawer');
document.getElementById('sessionTab').onclick=()=>drawer.classList.toggle('open');
document.getElementById('sessionClose').onclick=()=>drawer.classList.remove('open');
document.querySelectorAll('.session-item').forEach(item=>item.onclick=()=>{document.querySelectorAll('.session-item').forEach(x=>x.classList.remove('selected'));item.classList.add('selected');drawer.classList.remove('open')});
const phone=document.getElementById('phoneOverlay'), log=document.getElementById('logOverlay');
function closeOverlays(){document.querySelectorAll('.overlay').forEach(x=>x.classList.remove('open'))}
document.getElementById('phoneOpen').onclick=()=>phone.classList.add('open');
document.getElementById('logOpen').onclick=()=>log.classList.add('open');
document.querySelectorAll('.overlay-close,.overlay-dim').forEach(x=>x.onclick=closeOverlays);
const lines=['うーん、その方法でもできますが、一つ問題があります。<br>……あ、待って。もっと簡単な方法があります。<br>これならかなり綺麗にできますよ。','まずは画面を「会話」と「システム」に分けて考えるのが良さそうです。<br>PHONEとBACKLOGは、会話から離れずに重ねて開けるようにします。','詳しい内容はPHONEに送っておきました。<br>必要なときだけ、右側のPHONEから開いてください。'];let i=0;
document.getElementById('nextBtn').onclick=()=>{i=(i+1)%lines.length;document.getElementById('dialogueText').innerHTML=lines[i]};
document.getElementById('sendBtn').onclick=()=>{const input=document.querySelector('.inputbar input');if(!input.value.trim())return;const old=input.value;input.value='';input.placeholder='「'+old+'」を送信しました（モック）';setTimeout(()=>input.placeholder='メッセージを入力してください……',1500)};
document.querySelectorAll('[data-char]').forEach(card=>card.addEventListener('click',()=>go('character-detail')));
document.getElementById('newCharacter')?.addEventListener('click',()=>go('character-detail'));
document.getElementById('addCharacter')?.addEventListener('click',()=>go('character-detail'));
document.getElementById('addExpression')?.addEventListener('click',()=>{const list=document.getElementById('expressionList');const row=document.createElement('div');row.className='expression-row';row.innerHTML=`<div class="expr-thumb">+</div><label>ID<input value="face_new"></label><label class="grow">説明<input placeholder="この表情を使う状況"></label><label>画像<button class="ghost full">画像を選択</button></label><label class="radio"><input type="radio" name="default-expression"> デフォルト</label><button class="icon danger-lite" onclick="this.parentElement.remove()">×</button>`;list.appendChild(row)});

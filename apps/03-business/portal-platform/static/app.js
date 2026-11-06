fetch('/oauth2/userinfo',{credentials:'same-origin'})
  .then(response=>response.ok?response.json():null)
  .then(user=>{if(user){document.getElementById('identity').textContent=user.email||user.preferredUsername||user.user||'Acesso autenticado'}})
  .catch(()=>{});


/* Sayur5 static app (vanilla JS) — drag & drop ready for Netlify */
const CATALOG_URL = "/data/sayur5_catalog.json";
const PRICE_DEFAULT = 5000;
const KEYS = {
  products: "sayur5_products",
  orders: "sayur5_orders",
  freeMin: "sayur5_freeMin",
  ongkir: "sayur5_ongkir",
  admins: "sayur5_admins",
  sessionUser: "sayur5_admin_sessionUser"
};

const toIDR = (n) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const normalizePrice = (v) => Math.max(1000, Math.round((v||0)/500)*500);
const sha256Hex = async (str) => {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
};
const slugify = (s) => String(s||"").toLowerCase().replace(/[±+]/g,"").replace(/[\/&]/g,"-").replace(/[.,]/g,"").replace(/\s+/g,"-").trim();

const App = {
  products: [],
  cart: {}, // id -> qty
  orders: [],
  freeMin: 30000,
  ongkir: 10000,
  adminUser: localStorage.getItem(KEYS.sessionUser) || "",
  admins: [],
  query: "",
  activeCat: "Semua",

  async init(){
    // Load settings
    this.freeMin = parseInt(localStorage.getItem(KEYS.freeMin)||"30000");
    this.ongkir = parseInt(localStorage.getItem(KEYS.ongkir)||"10000");
    UI.el("badgeFree").textContent = toIDR(this.freeMin);
    UI.el("inpFreeMin").value = this.freeMin;
    UI.el("inpOngkir").value = this.ongkir;

    // Load admins
    try { this.admins = JSON.parse(localStorage.getItem(KEYS.admins)||"[]"); } catch {}
    if (!Array.isArray(this.admins) || this.admins.length===0){
      const pinHash = await sha256Hex("1234");
      this.admins = [{ user: "owner", pinHash }];
      localStorage.setItem(KEYS.admins, JSON.stringify(this.admins));
    }

    // Load orders
    try { this.orders = JSON.parse(localStorage.getItem(KEYS.orders)||"[]"); } catch {}

    // Load products from local or JSON
    const saved = localStorage.getItem(KEYS.products);
    if (saved) {
      this.products = JSON.parse(saved);
    } else {
      try {
        const res = await fetch(CATALOG_URL, { cache: "no-store" });
        const payload = await res.json();
        const items = Array.isArray(payload) ? payload : payload.items;
        this.products = (items||[]).filter(it=>it.active!==false).map(it=> ({
          id: slugify(it.slug||it.name),
          name: it.name,
          unit: it.unit_or_isi || "",
          price: typeof it.price==='number' ? normalizePrice(it.price) : PRICE_DEFAULT,
          stock: typeof it.stock==='number' ? it.stock : 50,
          category: it.category || "Lainnya",
          emoji: "🥬",
          desc: it.unit_or_isi ? "Porsi: " + it.unit_or_isi : (it.category||"")
        }));
        localStorage.setItem(KEYS.products, JSON.stringify(this.products));
      } catch(e){
        console.warn("Gagal load JSON", e);
        this.products = [];
      }
    }

    UI.bind();
    UI.renderAll();
  },

  // Derived
  get categories(){
    const set = new Set(this.products.map(p=>p.category||"Lainnya"));
    return ["Semua", ...[...set].sort()];
  },
  get items(){
    return Object.entries(this.cart).map(([id, qty]) => ({ ...this.products.find(p=>p.id===id), id, qty }));
  },
  get subtotal(){
    return this.items.reduce((s,it)=> s + it.qty * (it.price||PRICE_DEFAULT), 0);
  },
  shippingFee(subtotal){
    return subtotal === 0 || subtotal >= this.freeMin ? 0 : this.ongkir;
  },
  get grandTotal(){ return this.subtotal + this.shippingFee(this.subtotal); },
  get totalQty(){ return this.items.reduce((s,it)=>s+it.qty,0); },

  // Ops
  search(q){ this.query = (q||"").toLowerCase().trim(); UI.renderGrid(); },
  setCat(c){ this.activeCat = c; UI.renderGrid(); },
  add(id){ const p=this.products.find(x=>x.id===id); if(!p) return; this.cart[id]=Math.min((this.cart[id]||0)+1, p.stock); UI.renderCartBadge(); },
  sub(id){ if(!this.cart[id]) return; this.cart[id]=Math.max(0, this.cart[id]-1); if(this.cart[id]===0) delete this.cart[id]; UI.renderCart(); UI.renderCartBadge(); },
  clearCart(){ this.cart={}; UI.renderCart(); UI.renderCartBadge(); },

  // Checkout
  saveOrder(payload){
    const order = {
      id: "INV-" + Date.now(),
      date: new Date().toISOString(),
      ...payload,
      items: this.items.map(({id,name,qty,price})=>({id,name,qty,price})),
      subtotal: this.subtotal,
      shipping: this.shippingFee(this.subtotal),
      total: this.grandTotal,
      status: "baru"
    };
    // reduce stock
    this.products = this.products.map(p => {
      const it = this.items.find(i=>i.id===p.id);
      return it ? { ...p, stock: Math.max(0, p.stock - it.qty) } : p;
    });
    localStorage.setItem(KEYS.products, JSON.stringify(this.products));
    this.orders = [order, ...this.orders];
    localStorage.setItem(KEYS.orders, JSON.stringify(this.orders));
    this.clearCart();
    alert("Pesanan dicatat! Admin akan menghubungi via WhatsApp.");
  },

  // Admin
  async login(user, pin){
    const found = this.admins.find(a=>a.user===user);
    if(!found) throw new Error("User admin tidak ditemukan");
    const hash = await sha256Hex(pin);
    if (hash !== found.pinHash) throw new Error("PIN salah");
    this.adminUser = user;
    localStorage.setItem(KEYS.sessionUser, user);
  },
  logout(){
    this.adminUser="";
    localStorage.removeItem(KEYS.sessionUser);
  },
  addAdmin: async function(user, pin){
    if(!user||!pin) throw new Error("Lengkapi user & PIN");
    if(this.admins.find(a=>a.user===user)) throw new Error("User sudah ada");
    const pinHash = await sha256Hex(pin);
    this.admins.push({ user, pinHash });
    localStorage.setItem(KEYS.admins, JSON.stringify(this.admins));
  },
  removeAdmin(user){
    if(this.admins.length<=1) throw new Error("Minimal 1 admin harus tersisa");
    this.admins = this.admins.filter(a=>a.user!==user);
    localStorage.setItem(KEYS.admins, JSON.stringify(this.admins));
  },

  // Product CRUD (localStorage only)
  addProduct(p){
    if(!p.id || !p.name) throw new Error("ID & Nama wajib");
    if(this.products.some(x=>x.id===p.id)) throw new Error("ID sudah dipakai");
    p.price = normalizePrice(p.price||PRICE_DEFAULT);
    this.products = [p, ...this.products];
    localStorage.setItem(KEYS.products, JSON.stringify(this.products));
    UI.renderAll();
  },
  updateProduct(id, patch){
    const idx = this.products.findIndex(p=>p.id===id);
    if(idx<0) return;
    const next = {...this.products[idx], ...patch};
    if("price" in patch) next.price = normalizePrice(patch.price);
    this.products[idx] = next;
    localStorage.setItem(KEYS.products, JSON.stringify(this.products));
    UI.renderAll();
  },
  deleteProduct(id){
    this.products = this.products.filter(p=>p.id!==id);
    localStorage.setItem(KEYS.products, JSON.stringify(this.products));
    UI.renderAll();
  },

  // Settings
  setShipping(freeMin, ongkir){
    this.freeMin = parseInt(freeMin||0);
    this.ongkir = parseInt(ongkir||0);
    localStorage.setItem(KEYS.freeMin, String(this.freeMin));
    localStorage.setItem(KEYS.ongkir, String(this.ongkir));
    UI.el("badgeFree").textContent = toIDR(this.freeMin);
    UI.el("inpFreeMin").value = this.freeMin;
    UI.el("inpOngkir").value = this.ongkir;
    UI.renderCart();
  }
};

const UI = {
  el(id){ return document.getElementById(id); },

  bind(){
    this.el("search").addEventListener("input", (e)=>App.search(e.target.value));
    this.el("btnCart").onclick = ()=>this.openCart();
    this.el("btnCartM").onclick = ()=>this.openCart();
    this.el("btnAdmin").onclick = ()=>this.openAdmin();
    this.el("btnAdminM").onclick = ()=>this.openAdmin();

    // cart
    this.el("btnCheckout").onclick = ()=>this.openCheckout();
    this.el("inpFreeMin").addEventListener("change", (e)=>App.setShipping(e.target.value, App.ongkir));
    this.el("inpOngkir").addEventListener("change", (e)=>App.setShipping(App.freeMin, e.target.value));

    // admin auth
    this.el("admLoginBtn").onclick = async ()=>{
      this.el("admErr").textContent="";
      try{ await App.login(this.el("admUser").value, this.el("admPin").value); this.showAdminArea(); }
      catch(err){ this.el("admErr").textContent = err.message; }
    };
    this.el("admLogout").onclick = ()=>{ App.logout(); this.showAdminLogin(); };

    // add product
    this.el("pAdd").onclick = ()=>{
      try {
        App.addProduct({
          id: (document.getElementById("pId").value||"").toLowerCase(),
          name: document.getElementById("pName").value,
          unit: document.getElementById("pUnit").value,
          stock: parseInt(document.getElementById("pStock").value||"0"),
          price: parseInt(document.getElementById("pPrice").value||"5000"),
          category: document.getElementById("pCat").value || "Lainnya",
          emoji: "🥬",
          desc: ""
        });
        alert("Produk ditambahkan");
      } catch(e){ alert(e.message); }
    };

    // admin settings
    this.el("setFree").value = App.freeMin;
    this.el("setOngkir").value = App.ongkir;
    this.el("setFree").addEventListener("change", (e)=>App.setShipping(e.target.value, App.ongkir));
    this.el("setOngkir").addEventListener("change", (e)=>App.setShipping(App.freeMin, e.target.value));

    // orders CSV
    this.el("csvBtn").onclick = ()=>this.downloadCSV();
    this.el("addAdminBtn").onclick = async ()=>{
      try{ await App.addAdmin(this.el("newUser").value, this.el("newPin").value); alert("Admin ditambahkan"); this.renderAdminList(); }
      catch(e){ alert(e.message); }
    };
  },

  renderAll(){
    this.renderCategories();
    this.renderGrid();
    this.renderCartBadge();
    if(this.isAdminOpen()) {
      if(App.adminUser) this.showAdminArea(); else this.showAdminLogin();
    }
  },

  renderCategories(){
    const wrap = this.el("categoryTabs"); wrap.innerHTML="";
    const cats = App.categories;
    cats.forEach(c=>{
      const b = document.createElement("button");
      b.className = "btn-outline h-8";
      b.textContent = c;
      if (c===App.activeCat) b.className = "btn h-8";
      b.onclick = ()=>{ App.setCat(c); this.renderCategories(); };
      wrap.appendChild(b);
    });
  },

  renderGrid(){
    const grid = this.el("grid"); grid.innerHTML="";
    const q = App.query;
    const list = App.products.filter(p=>{
      const okQ = !q || p.name.toLowerCase().includes(q) || (p.id||"").includes(q);
      const okCat = App.activeCat==="Semua" || (p.category||"Lainnya")===App.activeCat;
      return okQ && okCat;
    });
    list.forEach(p=>{
      const card = document.createElement("div");
      card.className = "card overflow-hidden";
      card.innerHTML = `
        <div class="h-28 bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center text-5xl">🥬</div>
        <div class="p-4">
          <div class="font-semibold">${p.name}</div>
          <div class="text-xs text-slate-500 mt-1">${p.unit ? "Isi: "+p.unit : (p.desc||"")}</div>
          <div class="mt-2 flex items-center justify-between">
            <div class="font-bold">${toIDR(p.price||${PRICE_DEFAULT})}</div>
            <div class="text-xs text-slate-500">Stok: ${p.stock}</div>
          </div>
          <div class="mt-3 flex gap-2">
            <button class="btn flex-1">Tambah</button>
            <button class="btn-outline">+1</button>
          </div>
        </div>
      `;
      const [btnAdd, btnPlus] = card.querySelectorAll("button");
      btnAdd.onclick = ()=>{ App.add(p.id); };
      btnPlus.onclick = ()=>{ App.add(p.id); };
      grid.appendChild(card);
    });
  },

  renderCartBadge(){
    const b = this.el("badgeQty");
    const qty = App.totalQty;
    if(qty>0){ b.textContent = qty; b.classList.remove("hidden"); } else { b.classList.add("hidden"); }
  },

  renderCart(){
    const list = this.el("cartList"); list.innerHTML="";
    App.items.forEach(it=>{
      const row = document.createElement("div");
      row.className = "card p-3 flex items-center gap-3";
      row.innerHTML = `
        <div class="w-10 h-10 rounded bg-emerald-100 flex items-center justify-center">🥬</div>
        <div class="flex-1">
          <div class="font-medium">${it.name}</div>
          <div class="text-xs text-slate-500">${toIDR(it.price)} / pack</div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-outline">-</button>
          <div class="w-8 text-center font-semibold">${it.qty}</div>
          <button class="btn-outline">+</button>
        </div>
        <div class="w-24 text-right font-semibold">${toIDR(it.qty*it.price)}</div>
      `;
      const [btnSub, btnAdd] = row.querySelectorAll("button");
      btnSub.onclick = ()=>{ App.sub(it.id); this.renderCart(); };
      btnAdd.onclick = ()=>{ App.add(it.id); this.renderCart(); };
      list.appendChild(row);
    });
    this.el("cartSubtotal").textContent = toIDR(App.subtotal);
    const ship = App.shippingFee(App.subtotal);
    this.el("cartShip").textContent = ship===0 ? "Gratis" : toIDR(ship);
    this.el("cartTotal").textContent = toIDR(App.grandTotal);
    this.el("inpFreeMin").value = App.freeMin;
    this.el("inpOngkir").value = App.ongkir;
  },

  openCart(){ this.renderCart(); this.el("cartModal").classList.add("open"); },
  closeCart(){ this.el("cartModal").classList.remove("open"); },

  openCheckout(){
    if(App.items.length===0){ alert("Keranjang kosong"); return; }
    this.el("checkoutEmpty").classList.add("hidden");
    this.el("checkoutForm").classList.remove("hidden");
    const sumList = this.el("sumList"); sumList.innerHTML="";
    App.items.forEach(it=>{
      const row = document.createElement("div");
      row.className = "flex justify-between";
      row.innerHTML = `<span>${it.name} x${it.qty}</span><span>${toIDR(it.qty*it.price)}</span>`;
      sumList.appendChild(row);
    });
    const ship = App.shippingFee(App.subtotal);
    this.el("sumSub").textContent = toIDR(App.subtotal);
    this.el("sumShip").textContent = ship===0 ? "Gratis" : toIDR(ship);
    this.el("sumTotal").textContent = toIDR(App.subtotal + ship);

    const payload = {
      name: this.el("fName").value || "",
      phone: this.el("fPhone").value || "",
      address: this.el("fAddr").value || "",
      payment: this.el("fPay").value || "transfer",
      note: this.el("fNote").value || ""
    };
    const lines = [
      "Pesanan Sayur5",
      "Nama: "+payload.name,
      "Telp: "+payload.phone,
      "Alamat: "+payload.address,
      "Metode Bayar: "+payload.payment,
      "Rincian:",
      ...App.items.map(it=>`- ${it.name} x${it.qty} @${toIDR(it.price)} = ${toIDR(it.qty*it.price)}`),
      "Subtotal: " + toIDR(App.subtotal),
      "Ongkir: " + (ship===0 ? "Gratis" : toIDR(ship)),
      "Total: " + toIDR(App.subtotal + ship),
      payload.note ? "Catatan: "+payload.note : ""
    ].filter(Boolean);
    const orderText = encodeURIComponent(lines.join("\n"));
    const wa = "https://wa.me/6281234567890?text="+orderText;
    this.el("waBtn").href = wa;
    this.el("saveBtn").onclick = ()=>{
      const data = {
        name: this.el("fName").value,
        phone: this.el("fPhone").value,
        address: this.el("fAddr").value,
        payment: this.el("fPay").value,
        note: this.el("fNote").value
      };
      if(!data.name || !data.phone || !data.address){ alert("Lengkapi nama/HP/alamat"); return; }
      App.saveOrder(data);
      this.closeCheckout(); this.closeCart(); this.renderGrid();
    };

    this.el("checkoutModal").classList.add("open");
  },
  closeCheckout(){ this.el("checkoutModal").classList.remove("open"); },

  openAdmin(){
    this.el("admErr").textContent="";
    if(App.adminUser) this.showAdminArea(); else this.showAdminLogin();
    this.el("adminModal").classList.add("open");
  },
  closeAdmin(){ this.el("adminModal").classList.remove("open"); },
  isAdminOpen(){ return this.el("adminModal").classList.contains("open"); },

  showAdminLogin(){
    this.el("adminLogin").classList.remove("hidden");
    this.el("adminArea").classList.add("hidden");
  },
  showAdminArea(){
    this.el("adminLogin").classList.add("hidden");
    this.el("adminArea").classList.remove("hidden");
    this.el("admWho").textContent = App.adminUser || "";
    this.renderAdminProducts();
    this.renderOrders();
    this.renderAdminList();
    this.el("setFree").value = App.freeMin;
    this.el("setOngkir").value = App.ongkir;
  },

  renderAdminProducts(){
    const wrap = this.el("prodList"); wrap.innerHTML="";
    App.products.forEach(p=>{
      const row = document.createElement("div");
      row.className = "card p-2 flex items-center gap-2";
      row.innerHTML = `
        <div class="text-2xl">🥬</div>
        <div class="flex-1 grid grid-cols-2 gap-2">
          <input class="input" value="${p.name}"/>
          <input class="input" value="${p.unit||""}" placeholder="Isi/Unit"/>
          <input class="input" type="number" value="${p.price||${PRICE_DEFAULT}}"/>
          <input class="input" type="number" value="${p.stock}"/>
          <input class="input col-span-2" value="${p.category||"Lainnya"}"/>
        </div>
        <div class="grid gap-2">
          <button class="btn-outline">Simpan</button>
          <button class="btn-outline">Hapus</button>
        </div>
      `;
      const [nm, unit, price, stock, cat] = row.querySelectorAll("input");
      const [btnSave, btnDel] = row.querySelectorAll("button");
      btnSave.onclick = ()=>{
        App.updateProduct(p.id, { name: nm.value, unit: unit.value, price: parseInt(price.value||"0"), stock: parseInt(stock.value||"0"), category: cat.value });
        alert("Tersimpan");
      };
      btnDel.onclick = ()=>{ if(confirm("Hapus produk?")) App.deleteProduct(p.id); };
      wrap.appendChild(row);
    });
  },

  renderOrders(){
    const wrap = this.el("orderList"); wrap.innerHTML="";
    if(App.orders.length===0){ wrap.innerHTML='<div class="text-sm text-slate-500">Belum ada pesanan.</div>'; return; }
    App.orders.forEach(o=>{
      const div = document.createElement("div");
      div.className = "card p-3 text-sm";
      div.innerHTML = `
        <div class="flex justify-between"><b>${o.id}</b><span class="text-xs text-slate-500">${new Date(o.date).toLocaleString('id-ID')}</span></div>
        <div>${o.name} • ${o.phone}</div>
        <div class="text-slate-500">${o.address}</div>
        <div class="flex justify-between mt-1"><div>Metode: <b>${o.payment}</b></div><div>Total: <b>${toIDR(o.total)}</b></div></div>
        <div class="mt-1">Item: ${o.items.map(it=>`${it.name} x${it.qty}`).join(", ")}</div>
      `;
      wrap.appendChild(div);
    });
  },

  renderAdminList(){
    const ul = this.el("adminList"); ul.innerHTML="";
    App.admins.forEach(a=>{
      const li = document.createElement("li");
      li.className = "flex justify-between py-1";
      li.innerHTML = `<span>${a.user}</span>`;
      const b = document.createElement("button"); b.className="btn-outline"; b.textContent="Hapus";
      b.onclick = ()=>{ try{ App.removeAdmin(a.user); this.renderAdminList(); }catch(e){ alert(e.message); } };
      li.appendChild(b);
      ul.appendChild(li);
    });
  },

  downloadCSV(){
    const header = ["id","tanggal","nama","telepon","alamat","payment","subtotal","ongkir","total","status","items"];
    const rows = App.orders.map(o=>[
      o.id, new Date(o.date).toLocaleString('id-ID'), JSON.stringify(o.name), o.phone, JSON.stringify(o.address),
      o.payment, o.subtotal, o.shipping, o.total, o.status, o.items.map(it=>`${it.name} x${it.qty}`).join('; ')
    ]);
    const csv = [header.join(','), ...rows.map(r=>r.join(','))].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download = 'sayur5_orders.csv'; a.click(); URL.revokeObjectURL(url);
  }
};

window.App = App; window.UI = UI;
App.init();

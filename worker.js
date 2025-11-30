export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { headers: { ...headers, "Content-Type": "application/json" }, status });
    const err = (msg, status = 400) => json({ error: msg }, status);

    try {
      let body = {};
      if (request.method !== "GET" && request.method !== "DELETE") { try { body = await request.json(); } catch(e) {} }

      // --- PUBLIC ---
      if (url.pathname === "/api/register" && request.method === "POST") {
        const { email, password, shop_name } = body;
        const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
        if (existing) return err("Email sudah terdaftar");
        const pwHash = await hashPassword(password);
        await env.DB.prepare("INSERT INTO users (email, password, shop_name, role, status) VALUES (?, ?, ?, 'user', 'pending')").bind(email, pwHash, shop_name || "Agen Baru").run();
        return json({ message: "Pendaftaran berhasil!" });
      }

      if (url.pathname === "/api/login" && request.method === "POST") {
        const { email, password } = body;
        const pwHash = await hashPassword(password);
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? AND password = ?").bind(email, pwHash).first();
        if (!user) return err("Email/Password salah", 401);
        if (user.status !== 'active') return err("Akun belum aktif. Hubungi Admin.", 403);
        
        // CEK EXPIRED (Opsional: Blokir jika expired)
        // const now = new Date();
        // const subDate = new Date(user.subscription_until);
        // if(user.role !== 'admin' && subDate < now) return err("Masa aktif habis. Silakan perpanjang.", 402);

        const token = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").bind(token, user.id).run();
        
        return json({ 
            token, 
            shop_name: user.shop_name, 
            default_profit: user.default_profit, 
            role: user.role,
            subscription_until: user.subscription_until // KIRIM TANGGAL EXP KE FRONTEND
        });
      }

      if (url.pathname === "/api/products" && request.method === "GET") {
        const res = await env.DB.prepare("SELECT * FROM products WHERE is_active = 1 ORDER BY type DESC, name ASC").all();
        return json({ data: res.results });
      }

      // --- PRIVATE ---
      const authHeader = request.headers.get("Authorization");
      const token = authHeader ? authHeader.split(" ")[1] : null;
      if (url.pathname.startsWith("/api/") && !token) return err("Unauthorized", 401);

      let user = null;
      if (token) {
          user = await env.DB.prepare(`SELECT u.id, u.role, u.shop_name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?`).bind(token).first();
          if (!user) return err("Sesi habis", 401);
      }

      // ... (Bagian Transaksi, History, Stats, Settings SAMA SEPERTI SEBELUMNYA) ...
      // Agar kode tidak terlalu panjang, bagian Transaksi s.d Settings pakai kode lama Anda.
      // Copy-paste bagian Transaksi, History, Stats, Settings dari kode sebelumnya ke sini.
      
      // INSERT OLD CODE HERE FOR: /api/transaction, /api/history, /api/stats, /api/settings
      // -----------------------------------------------------------------------------------
      if (url.pathname === "/api/transaction") { const { ewallet, nominal, admin, profit, total, type } = body; await env.DB.prepare(`INSERT INTO transactions (user_id, ewallet_name, nominal, admin_bank, merchant_fee, total_price, type) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(user.id, ewallet, nominal, admin, profit, total, type || 'TOPUP').run(); return json({ message: "Saved" }); }
      if (url.pathname === "/api/history") { const res = await env.DB.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50").bind(user.id).all(); return json({ data: res.results }); }
      if (url.pathname === "/api/stats") { const all = await env.DB.prepare(`SELECT COUNT(*) as count, SUM(total_price) as omzet, SUM(merchant_fee) as cuan FROM transactions WHERE user_id = ?`).bind(user.id).first(); const today = await env.DB.prepare(`SELECT SUM(total_price) as omzet, SUM(merchant_fee) as cuan FROM transactions WHERE user_id = ? AND date(created_at, '+7 hours') = date('now', '+7 hours')`).bind(user.id).first(); const month = await env.DB.prepare(`SELECT SUM(total_price) as omzet, SUM(merchant_fee) as cuan FROM transactions WHERE user_id = ? AND strftime('%Y-%m', created_at, '+7 hours') = strftime('%Y-%m', 'now', '+7 hours')`).bind(user.id).first(); const wallets = await env.DB.prepare(`SELECT ewallet_name, COUNT(*) as count, SUM(total_price) as total FROM transactions WHERE user_id = ? GROUP BY ewallet_name ORDER BY count DESC`).bind(user.id).all(); return json({ all, today, month, wallets: wallets.results }); }
      if (url.pathname === "/api/settings") { const { default_profit } = body; await env.DB.prepare("UPDATE users SET default_profit = ? WHERE id = ?").bind(default_profit, user.id).run(); return json({ message: "Saved" }); }
      // -----------------------------------------------------------------------------------

      // --- ADMIN ROUTES ---
      if (url.pathname.startsWith("/api/admin")) {
          if (user.role !== 'admin') return err("Forbidden", 403);
      }

      if (url.pathname === "/api/admin/users" && request.method === "GET") {
          // UPDATE: Ambil juga subscription_until
          const res = await env.DB.prepare("SELECT id, email, shop_name, status, role, subscription_until, created_at FROM users ORDER BY created_at DESC").all();
          return json({ data: res.results });
      }

      // UPDATE STATUS & SUBSCRIPTION USER
      if (url.pathname === "/api/admin/users/status" && request.method === "POST") {
          const { user_id, status, subscription_until } = body;
          
          // Jika admin kirim tanggal langganan, update itu juga
          if (subscription_until) {
              await env.DB.prepare("UPDATE users SET status = ?, subscription_until = ? WHERE id = ?")
                .bind(status, subscription_until, user_id).run();
          } else {
              await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?").bind(status, user_id).run();
          }
          return json({ message: "User Updated" });
      }

      // ... (Bagian Manage Products SAMA SEPERTI SEBELUMNYA) ...
      // Copy-paste bagian /api/admin/products dan /api/upload dari kode sebelumnya ke sini.
      
      // INSERT OLD CODE FOR PRODUCTS & UPLOAD
      // -----------------------------------------------------------------------------------
      if (url.pathname === "/api/upload") { if (!env.BUCKET) return err("No Bucket", 500); const f = Date.now() + "-" + Math.floor(Math.random()*1000) + ".png"; await env.BUCKET.put(f, request.body, {httpMetadata:{contentType:"image/png"}}); return json({url: `${url.origin}/api/image/${f}`}); }
      if (url.pathname.startsWith("/api/image/")) { const k=url.pathname.split('/').pop(); const o=await env.BUCKET.get(k); if(!o) return new Response("404",{status:404}); const h=new Headers(headers); o.writeHttpMetadata(h); return new Response(o.body,{headers:h}); }
      if (url.pathname === "/api/admin/products") { 
          if(request.method==="POST"){ const{name,type,admin_fee,icon,color}=body; await env.DB.prepare("INSERT INTO products(name,type,admin_fee,icon,color,is_active) VALUES(?,?,?,?,?,1)").bind(name,type,admin_fee,icon,color||'text-gray-600').run(); return json({message:"Created"}); }
          if(request.method==="PUT"){ const{id,name,type,admin_fee,icon,color}=body; await env.DB.prepare("UPDATE products SET name=?,type=?,admin_fee=?,icon=?,color=? WHERE id=?").bind(name,type,admin_fee,icon,color||'text-gray-600',id).run(); return json({message:"Updated"}); }
          if(request.method==="DELETE"){ const id=new URL(request.url).searchParams.get("id"); await env.DB.prepare("DELETE FROM products WHERE id=?").bind(id).run(); return json({message:"Deleted"}); }
      }
      // -----------------------------------------------------------------------------------

      return json({ msg: "API V6 Ready (Subscription)" });

    } catch (e) { return err(e.message, 500); }
  }
};

async function hashPassword(str) {
  const myText = new TextEncoder().encode(str);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  return [...new Uint8Array(myDigest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
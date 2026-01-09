import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import pg from "pg";
import bcrypt from "bcrypt";
import env from "dotenv";
import multer from "multer";
import path from "path";
import flash from "connect-flash";
import { body, validationResult } from "express-validator";
import nodemailer from "nodemailer"; // <--- NOWOŚĆ: Import nodemailera

const app = express();
const port = 3000;
env.config();

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

// Konfiguracja wysyłania maili
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  // -----------------------------------------------
});

const storage = multer.diskStorage({
  destination: "public/uploads/",
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  },
});
const upload = multer({ storage });

app.use(express.static("public"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 60 * 60 * 1000 }, // 1 godzina
  })
);
app.use(flash());

app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  res.locals.user = req.session.userId || null;
  next();
});

app.set("view engine", "ejs");

app.get("/", (req, res) => {
  res.render("homePage.ejs", {
    showRegister: !!req.query.showRegister,
  });
});

app.post(
  "/login",
  [
    body("login", "Login nie może być pusty.").notEmpty(),
    body("password", "Hasło nie może być puste.").notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash("error_msg", errors.array()[0].msg);
      return res.redirect("/");
    }

    const { login, password } = req.body;
    try {
      const result = await db.query(
        "SELECT * FROM users WHERE LOWER(login) = LOWER($1)",
        [login]
      );
      if (result.rows.length === 0) {
        req.flash(
          "error_msg",
          "Nie znaleziono użytkownika lub hasło jest błędne."
        );
        return res.redirect("/");
      }

      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        req.flash(
          "error_msg",
          "Nie znaleziono użytkownika lub hasło jest błędne."
        );
        return res.redirect("/");
      }
      req.session.userId = user.id;
      req.session.userName = user.name;
      res.redirect("/index");
    } catch (err) {
      console.error(err);
      req.flash("error_msg", "Błąd serwera");
      res.redirect("/");
    }
  }
);

app.post(
  "/register",
  [
    body("name", "Imię jest wymagane.").trim().notEmpty(),
    body("surname", "Nazwisko jest wymagane.").trim().notEmpty(),
    body("email", "Podaj poprawny adres e-mail").isEmail().normalizeEmail(), // <--- NOWOŚĆ walidacja maila
    body("login", "Login jest wymagany i musi mieć min. 3 znaki.")
      .trim()
      .isLength({ min: 3 }),
    body("password", "Hasło musi mieć min. 6 znaków.").isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash("error_msg", errors.array()[0].msg);
      return res.redirect("/?showRegister=true");
    }

    const { name, surname, email, login, password } = req.body;

    try {
      // Sprawdzamy czy login zajęty
      const existingLogin = await db.query(
        "SELECT * FROM users WHERE LOWER(login) = LOWER($1)",
        [login]
      );
      if (existingLogin.rows.length > 0) {
        req.flash("error_msg", "Ten login jest już zajęty!");
        return res.redirect("/?showRegister=true");
      }

      // Sprawdzamy czy email zajęty
      const existingEmail = await db.query(
        "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
        [email]
      );
      if (existingEmail.rows.length > 0) {
        req.flash("error_msg", "Ten adres e-mail jest już zajęty!");
        return res.redirect("/?showRegister=true");
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Dodajemy email do inserta
      await db.query(
        "INSERT INTO users (name, surname, email, login, password) VALUES ($1, $2, $3, $4, $5)",
        [name, surname, email, login, hashedPassword]
      );

      req.flash(
        "success_msg",
        "Rejestracja pomyślna! Możesz się teraz zalogować."
      );
      res.redirect("/");
    } catch (err) {
      console.error(err);
      req.flash("error_msg", "Wystąpił błąd podczas rejestracji.");
      res.redirect("/?showRegister=true");
    }
  }
);

// ===== NOWE ROUTY: RESET HASŁA =====

// 1. Formularz wpisania maila
app.get("/forgot-password", (req, res) => {
  res.render("forgot-password.ejs");
});

// 2. Obsługa wysłania kodu
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    req.flash("error_msg", "Podaj adres e-mail");
    return res.redirect("/forgot-password");
  }

  try {
    // Sprawdź czy user istnieje
    const userRes = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (userRes.rows.length === 0) {
      // Ze względów bezpieczeństwa można napisać "Jeśli konto istnieje, wysłano kod",
      // ale dla wygody napiszemy wprost:
      req.flash("error_msg", "Nie znaleziono konta z takim adresem e-mail.");
      return res.redirect("/forgot-password");
    }

    // Generuj kod (np. 6 cyfr)
    const token = Math.floor(100000 + Math.random() * 900000).toString();

    // Ustaw czas wygaśnięcia (np. 15 minut)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Zapisz do bazy (najpierw usuń stare kody dla tego maila, żeby nie śmiecić)
    await db.query("DELETE FROM password_resets WHERE email = $1", [email]);
    await db.query(
      "INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)",
      [email, token, expiresAt]
    );

    // Wyślij maila
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Reset hasła - Mój Blog",
      text: `Twój kod do resetu hasła to: ${token}\nKod jest ważny przez 15 minut.`,
    };

    await transporter.sendMail(mailOptions);

    req.flash(
      "success_msg",
      "Kod weryfikacyjny został wysłany na Twój e-mail."
    );
    res.redirect("/reset-password");
  } catch (err) {
    console.error("Błąd resetu hasła:", err);
    req.flash("error_msg", "Wystąpił błąd serwera.");
    res.redirect("/forgot-password");
  }
});

// 3. Formularz wpisania kodu i nowego hasła
app.get("/reset-password", (req, res) => {
  res.render("reset-password.ejs");
});

// 4. Zatwierdzenie zmiany hasła
app.post("/reset-password", async (req, res) => {
  const { email, token, newPassword } = req.body;

  try {
    // Sprawdź czy kod jest poprawny i czy nie wygasł
    const resetRecord = await db.query(
      "SELECT * FROM password_resets WHERE email = $1 AND token = $2",
      [email, token]
    );

    if (resetRecord.rows.length === 0) {
      req.flash("error_msg", "Nieprawidłowy kod lub email.");
      return res.redirect("/reset-password");
    }

    const record = resetRecord.rows[0];
    if (new Date() > new Date(record.expires_at)) {
      req.flash("error_msg", "Kod wygasł. Wygeneruj nowy.");
      return res.redirect("/forgot-password");
    }

    // Hashuj nowe hasło i zaktualizuj usera
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = $1 WHERE email = $2", [
      hashedNewPassword,
      email,
    ]);

    // Usuń wykorzystany kod
    await db.query("DELETE FROM password_resets WHERE email = $1", [email]);

    req.flash("success_msg", "Hasło zostało zmienione! Możesz się zalogować.");
    res.redirect("/");
  } catch (err) {
    console.error("Błąd zmiany hasła:", err);
    req.flash("error_msg", "Wystąpił błąd serwera.");
    res.redirect("/reset-password");
  }
});

// ===== KONIEC SEKCJI RESETU HASŁA =====

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    res.redirect("/");
  });
});

app.get("/index", (req, res) => {
  if (!req.session.userId) return res.redirect("/");
  res.render("index.ejs", {
    name: req.session.userName,
    userId: req.session.userId,
  });
});

app.get("/profile", async (req, res) => {
  if (!req.session.userId) return res.redirect("/");

  const userStatsQuery = `
      SELECT 
        u.name, 
        u.surname,
        TO_CHAR(u.created_at, 'DD.MM.YYYY') AS registration_date,
        (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS posts_count,
        (SELECT COUNT(*) FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id = u.id)) AS likes_received_count
      FROM users u
      WHERE u.id = $1`;

  const userPostsQuery = `
      SELECT 
        p.id, p.title, p.content, p.image_url, p.user_id,
        TO_CHAR(p.created_at, 'DD.MM.YYYY o HH24:MI') AS creation_date,
        COUNT(l.id) AS likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
        EXISTS(SELECT 1 FROM likes WHERE likes.post_id = p.id AND likes.user_id = $1) AS is_liked
      FROM posts p
      LEFT JOIN likes l ON p.id = l.post_id
      WHERE p.user_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC`;

  const [statsResult, postsResult] = await Promise.all([
    db.query(userStatsQuery, [req.session.userId]),
    db.query(userPostsQuery, [req.session.userId]),
  ]);

  res.render("profile.ejs", {
    name: req.session.userName,
    userId: req.session.userId,
    stats: statsResult.rows[0],
    posts: postsResult.rows,
  });
});

app.get("/change-password", (req, res) => {
  if (!req.session.userId) return res.redirect("/");
  res.render("change-password.ejs", { error: null, success: null });
});

app.post("/change-password", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/");
  }

  const { oldPassword, newPassword } = req.body;
  const userId = req.session.userId;

  if (!oldPassword || !newPassword || newPassword.length < 6) {
    return res.render("change-password.ejs", {
      error: "Hasło musi mieć co najmniej 6 znaków.",
      success: null,
    });
  }

  try {
    const result = await db.query("SELECT password FROM users WHERE id = $1", [
      userId,
    ]);
    if (result.rows.length === 0) {
      return res.render("change-password.ejs", {
        error: "Nie znaleziono użytkownika.",
        success: null,
      });
    }
    const user = result.rows[0];

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.render("change-password.ejs", {
        error: "Stare hasło jest nieprawidłowe!",
        success: null,
      });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedNewPassword,
      userId,
    ]);

    res.render("change-password.ejs", {
      error: null,
      success: "Hasło zostało pomyślnie zmienione!",
    });
  } catch (err) {
    console.error("Błąd podczas zmiany hasła:", err);
    res.render("change-password.ejs", {
      error: "Wystąpił błąd serwera. Spróbuj ponownie.",
      success: null,
    });
  }
});

app.post(
  "/add-post",
  upload.single("image"),
  [
    body("title", "Tytuł nie może być pusty.").trim().notEmpty(),
    body("content", "Treść nie może być pusta.").trim().notEmpty(),
  ],
  async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Brak autoryzacji" });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { title, content } = req.body;
    const userId = req.session.userId;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    await db.query(
      "INSERT INTO posts (title, content, image_url, user_id) VALUES ($1, $2, $3, $4)",
      [title, content, imageUrl, userId]
    );

    res.json({ success: true, message: "Post dodany" });
  }
);

app.delete("/delete-post/:id", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Brak autoryzacji" });

  const userId = req.session.userId;
  const postId = req.params.id;
  const { rows } = await db.query("SELECT user_id FROM posts WHERE id = $1", [
    postId,
  ]);

  if (rows.length === 0 || rows[0].user_id !== userId) {
    return res.status(403).json({ error: "Brak uprawnień" });
  }

  await db.query("DELETE FROM posts WHERE id = $1", [postId]);
  res.json({ success: true, message: "Post usunięty" });
});

app.put(
  "/edit-post/:id",
  [
    body("title", "Tytuł nie może być pusty.").trim().notEmpty(),
    body("content", "Treść nie może być pusta.").trim().notEmpty(),
  ],
  async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Brak autoryzacji" });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { title, content } = req.body;
    const userId = req.session.userId;
    const postId = req.params.id;
    const { rows } = await db.query("SELECT user_id FROM posts WHERE id = $1", [
      postId,
    ]);

    if (rows.length === 0 || rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Brak uprawnień" });
    }

    await db.query("UPDATE posts SET title = $1, content = $2 WHERE id = $3", [
      title,
      content,
      postId,
    ]);
    res.json({ success: true, message: "Post zaktualizowany" });
  }
);

app.post("/like-post/:id", async (req, res) => {
  const userId = req.session.userId;
  const postId = req.params.id;

  if (!userId) {
    return res.status(401).json({ success: false, error: "Brak autoryzacji" });
  }

  try {
    const existingLike = await db.query(
      "SELECT * FROM likes WHERE post_id = $1 AND user_id = $2",
      [postId, userId]
    );

    if (existingLike.rows.length > 0) {
      await db.query("DELETE FROM likes WHERE post_id = $1 AND user_id = $2", [
        postId,
        userId,
      ]);
      res.json({ success: true, liked: false });
    } else {
      await db.query("INSERT INTO likes (post_id, user_id) VALUES ($1, $2)", [
        postId,
        userId,
      ]);
      res.json({ success: true, liked: true });
    }
  } catch (err) {
    console.error("Błąd podczas operacji polubienia posta:", err);
    res.status(500).json({ success: false, error: "Wystąpił błąd serwera" });
  }
});

app.get("/api/posts", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Brak autoryzacji" });

  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;

  const query = `
      SELECT 
        p.id, p.title, p.content, p.image_url, p.user_id,
        u.name || ' ' || u.surname AS author_full_name, 
        TO_CHAR(p.created_at, 'DD.MM.YYYY o HH24:MI') AS creation_date,
        COUNT(l.id) AS likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments_count,
        EXISTS(SELECT 1 FROM likes WHERE likes.post_id = p.id AND likes.user_id = $1) AS is_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN likes l ON p.id = l.post_id
      GROUP BY p.id, u.id
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3`;

  const result = await db.query(query, [req.session.userId, limit, offset]);
  res.json(result.rows);
});

// ===== ROUTY DLA KOMENTARZY =====

// Pobieranie komentarzy
app.get("/api/comments/:postId", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Brak autoryzacji" });

  const postId = req.params.postId;
  try {
    const query = `
      SELECT c.id, c.user_id, c.content, TO_CHAR(c.created_at, 'DD.MM.YYYY HH24:MI') as created_at,
      u.name || ' ' || u.surname as author_name
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `;
    const result = await db.query(query, [postId]);
    res.json({ success: true, comments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Błąd serwera" });
  }
});

// Dodawanie komentarza
app.post("/api/comments", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Brak autoryzacji" });

  const { postId, content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, error: "Treść pusta" });
  }

  try {
    const query = `
      INSERT INTO comments (post_id, user_id, content)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, content, TO_CHAR(created_at, 'DD.MM.YYYY HH24:MI') as created_at
    `;

    const result = await db.query(query, [postId, req.session.userId, content]);
    const newComment = result.rows[0];

    const userRes = await db.query(
      "SELECT name || ' ' || surname as author_name FROM users WHERE id = $1",
      [req.session.userId]
    );
    newComment.author_name = userRes.rows[0].author_name;

    res.json({ success: true, comment: newComment });
  } catch (err) {
    console.error("Błąd SQL podczas dodawania komentarza:", err);
    res.status(500).json({ success: false, error: "Błąd serwera" });
  }
});

// Usuwanie komentarza
app.delete("/api/comments/:id", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Brak autoryzacji" });

  const commentId = req.params.id;
  try {
    const check = await db.query("SELECT user_id FROM comments WHERE id = $1", [
      commentId,
    ]);
    if (check.rows.length === 0)
      return res.status(404).json({ error: "Komentarz nie istnieje" });
    if (check.rows[0].user_id !== req.session.userId)
      return res.status(403).json({ error: "Brak uprawnień" });

    await db.query("DELETE FROM comments WHERE id = $1", [commentId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Błąd serwera" });
  }
});

// Edycja komentarza
app.put("/api/comments/:id", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Brak autoryzacji" });

  const commentId = req.params.id;
  const { content } = req.body;

  if (!content || !content.trim())
    return res.status(400).json({ error: "Treść pusta" });

  try {
    const check = await db.query("SELECT user_id FROM comments WHERE id = $1", [
      commentId,
    ]);
    if (check.rows.length === 0)
      return res.status(404).json({ error: "Komentarz nie istnieje" });
    if (check.rows[0].user_id !== req.session.userId)
      return res.status(403).json({ error: "Brak uprawnień" });

    await db.query("UPDATE comments SET content = $1 WHERE id = $2", [
      content,
      commentId,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Błąd serwera" });
  }
});

app.listen(port, () =>
  console.log(`Serwer działa na http://localhost:${port}`)
);

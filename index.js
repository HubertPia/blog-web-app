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
  }
);

app.post(
  "/register",
  [
    body("name", "Imię jest wymagane.").trim().notEmpty(),
    body("surname", "Nazwisko jest wymagane.").trim().notEmpty(),
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

    const { name, surname, login, password } = req.body;
    const existingLogin = await db.query(
      "SELECT * FROM users WHERE LOWER(login) = LOWER($1)",
      [login]
    );
    if (existingLogin.rows.length > 0) {
      req.flash("error_msg", "Ten login jest już zajęty!");
      return res.redirect("/?showRegister=true");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (name, surname, login, password) VALUES ($1, $2, $3, $4)",
      [name, surname, login, hashedPassword]
    );

    req.flash(
      "success_msg",
      "Rejestracja pomyślna! Możesz się teraz zalogować."
    );
    res.redirect("/");
  }
);

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
    // NAPRAWIONE: Pobieramy c.user_id, aby frontend wiedział, czy to Twój komentarz
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

    // NAPRAWIONE: Poprawne przekazanie parametrów do SQL
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

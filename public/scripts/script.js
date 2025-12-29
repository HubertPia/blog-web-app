document.addEventListener("DOMContentLoaded", () => {
  let postToDeleteId = null;

  /*******************************************************************
   * SEKCJA 1: OBSŁUGA STRONY LOGOWANIA I REJESTRACJI
   *******************************************************************/

  const loginFormContainer = document.getElementById("login-form");
  const registerFormContainer = document.getElementById("register-form");
  const showRegisterLink = document.getElementById("show-register");
  const showLoginLink = document.getElementById("show-login");

  if (
    loginFormContainer &&
    registerFormContainer &&
    showRegisterLink &&
    showLoginLink
  ) {
    showRegisterLink.addEventListener("click", (e) => {
      e.preventDefault();
      loginFormContainer.classList.add("hidden");
      registerFormContainer.classList.remove("hidden");
    });

    showLoginLink.addEventListener("click", (e) => {
      e.preventDefault();
      registerFormContainer.classList.add("hidden");
      loginFormContainer.classList.remove("hidden");
    });
  }

  /*******************************************************************
   * SEKCJA 2: UI I UTILS
   *******************************************************************/

  const userMenuBtn = document.getElementById("userMenuBtn");
  const userMenu = document.getElementById("userMenu");

  if (userMenuBtn && userMenu) {
    userMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      userMenu.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (!userMenu.contains(e.target) && !userMenuBtn.contains(e.target)) {
        userMenu.classList.remove("show");
      }
    });
  }

  const fileInput = document.getElementById("createPostImage");
  const fileNameDisplay = document.getElementById("fileName");
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files.length > 0) {
        fileNameDisplay.textContent = `Wybrano: ${fileInput.files[0].name}`;
      } else {
        fileNameDisplay.textContent = "";
      }
    });
  }

  // --- FUNKCJA POMOCNICZA: TWORZENIE ELEMENTU KOMENTARZA ---
  const createCommentElement = (comment, currentUserId) => {
    const cDiv = document.createElement("div");
    cDiv.className = "comment-item";
    cDiv.dataset.id = comment.id;

    let actions = "";
    // Sprawdź czy to komentarz zalogowanego użytkownika
    // Używamy String(), aby uniknąć problemów z typami (np. liczba vs tekst)
    if (String(comment.user_id) === String(currentUserId)) {
      actions = `
            <div class="comment-actions">
                <button class="edit-comment-btn" data-id="${comment.id}" title="Edytuj"><i class="fas fa-edit"></i></button>
                <button class="delete-comment-btn" data-id="${comment.id}" title="Usuń"><i class="fas fa-trash"></i></button>
            </div>
          `;
    }

    cDiv.innerHTML = `
        <div class="comment-header">
            <div>
                <span class="comment-author">${comment.author_name}</span>
                <span style="font-size:0.8em; color:#ccc; margin-left:5px;">${comment.created_at}</span>
            </div>
            ${actions}
        </div>
        <div class="comment-content">${comment.content}</div>
      `;
    return cDiv;
  };

  /*******************************************************************
   * SEKCJA 3: GENEROWANIE POSTA
   *******************************************************************/

  const createPostElement = (post, currentUserId) => {
    const postDiv = document.createElement("div");
    postDiv.className = "post";
    postDiv.dataset.postId = post.id;

    const isLikedClass = post.is_liked ? "liked" : "";
    const authorLine = post.author_full_name
      ? `<span>Autor: <strong>${post.author_full_name}</strong></span>`
      : "";

    let buttons = "";
    if (String(post.user_id) === String(currentUserId)) {
      buttons = `
            <button class="editPost" data-id="${post.id}" data-title="${post.title}" data-content="${post.content}">Edytuj</button>
            <button class="deletePost" data-id="${post.id}">Usuń</button>
        `;
    }

    const imageTag = post.image_url
      ? `<img src="${post.image_url}" alt="Obrazek posta" class="post-image" />`
      : "";

    const commentsCount = post.comments_count || 0;

    postDiv.innerHTML = `
        <div class="post-meta">
            ${authorLine}
            <span>${post.creation_date}</span>
        </div>
        <h3>${post.title}</h3>
        <p>${post.content}</p>
        ${imageTag}
        <div class="post-actions">
            <div>${buttons}</div>
            <div style="display: flex; gap: 15px; align-items: center;">
                <button class="comment-btn toggle-comments" data-id="${post.id}">
                    <i class="far fa-comment-alt"></i> 
                    Komentarze (<span class="comments-count-label">${commentsCount}</span>)
                </button>
                <div class="like-container">
                    <button class="like-button ${isLikedClass}" data-id="${post.id}">
                        <i class="fas fa-heart"></i>
                    </button>
                    <span class="likes-count">${post.likes_count}</span>
                </div>
            </div>
        </div>

        <div class="comments-section" id="comments-${post.id}">
            <form class="add-comment-form" data-id="${post.id}">
                <input type="text" name="comment" placeholder="Napisz komentarz..." required autocomplete="off">
                <button type="submit">Wyślij</button>
            </form>
            <div class="comments-list" id="comments-list-${post.id}">
                <div style="text-align:center; color:#999; font-size:0.9rem; padding:10px;">Ładowanie...</div>
            </div>
        </div>
    `;
    return postDiv;
  };

  /*******************************************************************
   * SEKCJA 4: OBSŁUGA ZDARZEŃ (KLIKNIĘCIA)
   *******************************************************************/

  document.body.addEventListener("click", async (e) => {
    // 1. Lajki
    const likeButton = e.target.closest(".like-button");
    if (likeButton) {
      e.preventDefault();
      const postId = likeButton.dataset.id;
      const likeContainer = likeButton.closest(".like-container");
      if (!likeContainer) return;

      const likesCountSpan = likeContainer.querySelector(".likes-count");
      if (!likesCountSpan) return;

      let currentLikes = parseInt(likesCountSpan.textContent);
      const response = await fetch(`/like-post/${postId}`, { method: "POST" });
      const data = await response.json();

      if (data.success) {
        if (data.liked) {
          likeButton.classList.add("liked");
          currentLikes++;
        } else {
          likeButton.classList.remove("liked");
          currentLikes--;
        }
        likesCountSpan.textContent = currentLikes;
      }
      return;
    }

    // 2. Usuwanie posta
    const deleteButton = e.target.closest(".deletePost");
    if (deleteButton) {
      postToDeleteId = deleteButton.dataset.id;
      document.getElementById("modalOverlayConfirm").classList.add("active");
      document.getElementById("confirmDeleteModal").classList.add("active");
      return;
    }

    // 3. Edycja posta
    const editButton = e.target.closest(".editPost");
    if (editButton) {
      document.getElementById("editPostId").value = editButton.dataset.id;
      document.getElementById("editPostTitle").value = editButton.dataset.title;
      document.getElementById("editPostContent").value =
        editButton.dataset.content;
      document.getElementById("modalOverlayEdit").classList.add("active");
      document.getElementById("editPostModal").classList.add("active");
      return;
    }

    // 4. Powiększanie obrazka
    const postImage = e.target.closest(".post-image");
    if (postImage) {
      const imageModal = document.getElementById("imageModal");
      const enlargedImage = document.getElementById("enlargedImage");
      if (imageModal && enlargedImage) {
        enlargedImage.src = postImage.src;
        imageModal.classList.add("active");
      }
      return;
    }

    // 5. Otwieranie komentarzy
    const toggleCommentsBtn = e.target.closest(".toggle-comments");
    if (toggleCommentsBtn) {
      const postId = toggleCommentsBtn.dataset.id;
      const section = document.getElementById(`comments-${postId}`);
      const listContainer = document.getElementById(`comments-list-${postId}`);
      const currentUserId = document.body.dataset.userId;

      if (section.classList.contains("show")) {
        section.classList.remove("show");
      } else {
        section.classList.add("show");
        try {
          const response = await fetch(`/api/comments/${postId}`);
          const data = await response.json();
          if (data.success) {
            listContainer.innerHTML = "";
            if (data.comments.length === 0) {
              listContainer.innerHTML =
                '<div style="text-align:center; color:#999; font-size:0.9rem; padding:5px;">Brak komentarzy. Bądź pierwszy!</div>';
            } else {
              data.comments.forEach((c) => {
                const el = createCommentElement(c, currentUserId);
                listContainer.appendChild(el);
              });
            }
          }
        } catch (err) {
          listContainer.innerHTML =
            '<div style="color:red; text-align:center;">Błąd ładowania komentarzy.</div>';
        }
      }
      return;
    }

    // 6. Usuwanie komentarza
    const deleteCommentBtn = e.target.closest(".delete-comment-btn");
    if (deleteCommentBtn) {
      if (!confirm("Czy na pewno chcesz usunąć komentarz?")) return;

      const commentId = deleteCommentBtn.dataset.id;
      const commentItem = deleteCommentBtn.closest(".comment-item");

      try {
        const res = await fetch(`/api/comments/${commentId}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (data.success) {
          // Zaktualizuj licznik
          const postDiv = commentItem.closest(".post");
          if (postDiv) {
            const countSpan = postDiv.querySelector(".comments-count-label");
            if (countSpan)
              countSpan.textContent = Math.max(
                0,
                parseInt(countSpan.textContent) - 1
              );
          }
          commentItem.remove();
        } else {
          alert("Błąd: " + (data.error || "Nie można usunąć"));
        }
      } catch (e) {
        console.error(e);
      }
      return;
    }

    // 7. Edycja komentarza - włączenie trybu edycji
    const editCommentBtn = e.target.closest(".edit-comment-btn");
    if (editCommentBtn) {
      const commentItem = editCommentBtn.closest(".comment-item");
      const contentDiv = commentItem.querySelector(".comment-content");
      const currentContent = contentDiv.textContent;
      const commentId = editCommentBtn.dataset.id;

      // Zamień treść na formularz edycji
      contentDiv.innerHTML = `
            <div class="edit-comment-wrapper">
                <input type="text" class="edit-comment-input" value="${currentContent.replace(
                  /"/g,
                  "&quot;"
                )}" />
                <div class="edit-buttons">
                    <button class="save-comment-btn" data-id="${commentId}">Zapisz</button>
                    <button class="cancel-comment-btn" data-original="${currentContent.replace(
                      /"/g,
                      "&quot;"
                    )}">Anuluj</button>
                </div>
            </div>
        `;
      // Ukryj przyciski akcji na górze podczas edycji
      commentItem.querySelector(".comment-actions").style.display = "none";
      return;
    }

    // 8. Zapisanie edytowanego komentarza
    const saveCommentBtn = e.target.closest(".save-comment-btn");
    if (saveCommentBtn) {
      const commentId = saveCommentBtn.dataset.id;
      const wrapper = saveCommentBtn.closest(".edit-comment-wrapper");
      const input = wrapper.querySelector("input");
      const newContent = input.value;
      const commentItem = wrapper.closest(".comment-item");

      if (!newContent.trim()) return alert("Komentarz nie może być pusty");

      try {
        const res = await fetch(`/api/comments/${commentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        });
        const data = await res.json();
        if (data.success) {
          // Przywróć widok tekstu
          const contentDiv = commentItem.querySelector(".comment-content");
          contentDiv.textContent = newContent;
          commentItem.querySelector(".comment-actions").style.display = "flex";
        } else {
          alert("Błąd: " + data.error);
        }
      } catch (e) {
        console.error(e);
      }
      return;
    }

    // 9. Anulowanie edycji komentarza
    const cancelCommentBtn = e.target.closest(".cancel-comment-btn");
    if (cancelCommentBtn) {
      const originalContent = cancelCommentBtn.dataset.original;
      const wrapper = cancelCommentBtn.closest(".edit-comment-wrapper");
      const commentItem = wrapper.closest(".comment-item");
      const contentDiv = commentItem.querySelector(".comment-content");

      contentDiv.textContent = originalContent;
      commentItem.querySelector(".comment-actions").style.display = "flex";
      return;
    }
  });

  // --- SUBMIT FORMULARZA KOMENTARZA (DODAWANIE) ---
  document.body.addEventListener("submit", async (e) => {
    if (e.target.classList.contains("add-comment-form")) {
      e.preventDefault();
      const form = e.target;
      const postId = form.dataset.id;
      const input = form.querySelector("input[name='comment']");
      const content = input.value;
      const button = form.querySelector("button");
      const currentUserId = document.body.dataset.userId;

      if (!content.trim()) return;
      button.disabled = true;

      try {
        const response = await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, content }),
        });
        const data = await response.json();
        button.disabled = false;

        if (data.success) {
          input.value = "";
          const listContainer = document.getElementById(
            `comments-list-${postId}`
          );
          if (listContainer.innerHTML.includes("Brak komentarzy"))
            listContainer.innerHTML = "";

          // Używamy funkcji createCommentElement
          const cDiv = createCommentElement(data.comment, currentUserId);
          cDiv.style.animation = "fadeIn 0.5s ease";
          listContainer.prepend(cDiv);

          const postDiv = document.querySelector(
            `.post[data-post-id='${postId}']`
          );
          if (postDiv) {
            const countSpan = postDiv.querySelector(".comments-count-label");
            if (countSpan)
              countSpan.textContent = parseInt(countSpan.textContent) + 1;
          }
        } else {
          alert("Błąd dodawania komentarza.");
        }
      } catch (err) {
        console.error(err);
        button.disabled = false;
      }
    }
  });

  /*******************************************************************
   * SEKCJA 5: OBSŁUGA MODALI (TWORZENIE, EDYCJA POSTA)
   *******************************************************************/

  const openCreateModalButton = document.getElementById("openCreateModal");
  if (openCreateModalButton) {
    openCreateModalButton.addEventListener("click", () => {
      document.getElementById("modalOverlayCreate").classList.add("active");
      document.getElementById("createPostModal").classList.add("active");
    });
  }

  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
  const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
  const confirmModalOverlay = document.getElementById("modalOverlayConfirm");

  const closeConfirmModal = () => {
    document.getElementById("modalOverlayConfirm").classList.remove("active");
    document.getElementById("confirmDeleteModal").classList.remove("active");
    postToDeleteId = null;
  };

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", async () => {
      if (postToDeleteId) {
        const postElement = document.querySelector(
          `.post[data-post-id='${postToDeleteId}']`
        );
        if (postElement) {
          postElement.classList.add("fade-out");
          await fetch(`/delete-post/${postToDeleteId}`, { method: "DELETE" });
          setTimeout(() => postElement.remove(), 400);
        }
      }
      closeConfirmModal();
    });
  }

  if (cancelDeleteBtn)
    cancelDeleteBtn.addEventListener("click", closeConfirmModal);
  if (confirmModalOverlay)
    confirmModalOverlay.addEventListener("click", closeConfirmModal);

  const saveCreatePostButton = document.getElementById("saveCreatePost");
  if (saveCreatePostButton) {
    saveCreatePostButton.addEventListener("click", async () => {
      const title = document.getElementById("createPostTitle").value.trim();
      const content = document.getElementById("createPostContent").value.trim();
      const image = document.getElementById("createPostImage").files[0];
      if (!title || !content) return alert("Uzupełnij pola tytułu i treści!");
      const formData = new FormData();
      formData.append("title", title);
      formData.append("content", content);
      if (image) formData.append("image", image);
      const response = await fetch("/add-post", {
        method: "POST",
        body: formData,
      });
      if (response.ok) window.location.href = "/index";
      else alert("Wystąpił błąd podczas dodawania posta.");
    });
  }

  const saveEditPostButton = document.getElementById("saveEditPost");
  if (saveEditPostButton) {
    saveEditPostButton.addEventListener("click", async () => {
      const id = document.getElementById("editPostId").value;
      const title = document.getElementById("editPostTitle").value.trim();
      const content = document.getElementById("editPostContent").value.trim();
      const response = await fetch(`/edit-post/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      if (response.ok) {
        const postElement = document.querySelector(
          `.post[data-post-id='${id}']`
        );
        if (postElement) {
          postElement.querySelector("h3").textContent = title;
          postElement.querySelector("p").textContent = content;
          const editBtn = postElement.querySelector(".editPost");
          editBtn.dataset.title = title;
          editBtn.dataset.content = content;
        }
        document.getElementById("modalOverlayEdit").classList.remove("active");
        document.getElementById("editPostModal").classList.remove("active");
      } else alert("Wystąpił błąd podczas edycji.");
    });
  }

  document
    .querySelectorAll(".close, .modal-overlay:not(#modalOverlayConfirm)")
    .forEach((element) => {
      element.addEventListener("click", (e) => {
        if (e.target === element) {
          document
            .querySelectorAll(".modal.active, .modal-overlay.active")
            .forEach((activeEl) => {
              if (
                activeEl.id !== "confirmDeleteModal" &&
                activeEl.id !== "modalOverlayConfirm"
              ) {
                activeEl.classList.remove("active");
              }
            });
        }
      });
    });

  // INFINITE SCROLL
  const postsContainer = document.getElementById("postsContainer");
  if (postsContainer && !document.querySelector(".profile-section")) {
    let currentPage = 1;
    let isLoading = false;
    const loadingSpinner = document.getElementById("loadingSpinner");
    const currentUserId = document.body.dataset.userId;

    const loadPosts = async () => {
      if (isLoading) return;
      isLoading = true;
      if (loadingSpinner) loadingSpinner.style.display = "block";

      const response = await fetch(`/api/posts?page=${currentPage}`);
      const posts = await response.json();

      isLoading = false;
      if (loadingSpinner && posts.length > 0)
        loadingSpinner.style.display = "none";

      if (posts.length > 0) {
        posts.forEach((post) => {
          const postElement = createPostElement(post, currentUserId);
          postsContainer.appendChild(postElement);
        });
        currentPage++;
      } else {
        window.removeEventListener("scroll", handleScroll);
        if (loadingSpinner) {
          loadingSpinner.innerHTML = "<p>To już wszystkie posty!</p>";
          loadingSpinner.style.display = "block";
        }
      }
    };

    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
        document.body.offsetHeight - 500
      ) {
        loadPosts();
      }
    };
    loadPosts();
    window.addEventListener("scroll", handleScroll);
  }
});

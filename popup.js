// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  projects: [],
  currentProject: null,
  checkpoints: [],
  currentCheckpoint: null,
  filter: 'all',
  tagFilter: '',
  rating: 5,
  editMode: false
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  buildRatingStars();
  bindEvents();
  await loadProjects();

  // check if opened via context menu (pending text)
  const session = await chrome.storage.session.get('pendingText');
  if (session.pendingText) {
    document.getElementById('cp-text').value = session.pendingText;
    chrome.storage.session.remove('pendingText');
    // if there's a current project go straight to save view
    const last = localStorage.getItem('lastProjectId');
    if (last && state.projects.find(p => p.id === last)) {
      state.currentProject = state.projects.find(p => p.id === last);
      showView('view-save');
    }
  }
});

// ─── Messaging ────────────────────────────────────────────────────────────────

function msg(payload) {
  return chrome.runtime.sendMessage(payload);
}

// ─── Projects ─────────────────────────────────────────────────────────────────

async function loadProjects() {
  const res = await msg({ type: 'GET_PROJECTS' });
  state.projects = res.projects || [];
  renderProjects();
}

function renderProjects() {
  const list = document.getElementById('project-list');
  const empty = document.getElementById('empty-projects');
  list.innerHTML = '';

  if (!state.projects.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  state.projects.forEach(p => {
    const li = document.createElement('li');
    li.className = 'item-row';
    li.innerHTML = `
      <div class="item-main" data-id="${p.id}">
        <span class="item-name">${esc(p.name)}</span>
        <span class="item-meta">${timeAgo(p.updatedAt)}</span>
      </div>
      <button class="btn-icon-sm danger del-project" data-id="${p.id}" title="Delete project">✕</button>
    `;
    list.appendChild(li);
  });
}

async function createProject(name) {
  const res = await msg({ type: 'CREATE_PROJECT', name });
  state.projects.unshift(res.project);
  renderProjects();
  openProject(res.project);
}

async function deleteProject(id) {
  if (!confirm('Delete this project and all its checkpoints?')) return;
  await msg({ type: 'DELETE_PROJECT', projectId: id });
  state.projects = state.projects.filter(p => p.id !== id);
  renderProjects();
}

function openProject(project) {
  state.currentProject = project;
  localStorage.setItem('lastProjectId', project.id);
  document.getElementById('back-project-name').textContent = project.name;
  loadCheckpoints();
  showView('view-checkpoints');
}

// ─── Checkpoints ──────────────────────────────────────────────────────────────

async function loadCheckpoints() {
  const res = await msg({ type: 'GET_CHECKPOINTS', projectId: state.currentProject.id });
  state.checkpoints = res.checkpoints || [];
  renderCheckpoints();
}

function getFilteredCheckpoints() {
  let list = [...state.checkpoints];
  if (state.filter === 'gold') list = list.filter(c => c.gold);
  if (state.tagFilter) {
    const t = state.tagFilter.replace(/^#/, '').toLowerCase();
    list = list.filter(c => c.tags && c.tags.some(tag => tag.toLowerCase().includes(t)));
  }
  return list;
}

function renderCheckpoints() {
  const list = document.getElementById('checkpoint-list');
  const empty = document.getElementById('empty-checkpoints');
  list.innerHTML = '';

  const filtered = getFilteredCheckpoints();

  if (!filtered.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  filtered.forEach(cp => {
    const li = document.createElement('li');
    li.className = 'item-row cp-row';
    li.dataset.id = cp.id;

    const stars = ratingBar(cp.rating);
    const gold = cp.gold ? '<span class="gold-badge">⭐</span>' : '';
    const tags = (cp.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('');

    li.innerHTML = `
      <div class="item-main cp-main" data-id="${cp.id}">
        <div class="cp-header">
          ${gold}<span class="item-name">${esc(cp.name)}</span>
        </div>
        <div class="cp-meta-row">
          ${stars}
          <span class="item-meta">${timeAgo(cp.createdAt)}</span>
        </div>
        ${tags ? `<div class="cp-tags">${tags}</div>` : ''}
      </div>
    `;
    list.appendChild(li);
  });
}

async function saveCheckpoint() {
  const name = document.getElementById('cp-name').value.trim();
  const text = document.getElementById('cp-text').value.trim();
  const notes = document.getElementById('cp-notes').value.trim();
  const tagsRaw = document.getElementById('cp-tags').value.trim();
  const gold = document.getElementById('cp-gold').checked;

  if (!name) { showToast('Give this checkpoint a name'); return; }
  if (!text) { showToast('Paste some conversation text'); return; }

  const tags = tagsRaw
    .split(/[\s,]+/)
    .map(t => t.replace(/^#/, '').trim())
    .filter(Boolean);

  if (state.editMode && state.currentCheckpoint) {
    await msg({
      type: 'UPDATE_CHECKPOINT',
      id: state.currentCheckpoint.id,
      updates: { name, text, notes, tags, rating: state.rating, gold }
    });
    showToast('Checkpoint updated ✓');
  } else {
    await msg({
      type: 'SAVE_CHECKPOINT',
      projectId: state.currentProject.id,
      name, text, notes, tags,
      rating: state.rating,
      gold
    });
    showToast('Checkpoint saved ✓');
  }

  resetForm();
  await loadCheckpoints();
  showView('view-checkpoints');
}

async function deleteCheckpoint(id) {
  if (!confirm('Delete this checkpoint?')) return;
  await msg({ type: 'DELETE_CHECKPOINT', id });
  state.checkpoints = state.checkpoints.filter(c => c.id !== id);
  renderCheckpoints();
  showView('view-checkpoints');
}

function openCheckpoint(id) {
  const cp = state.checkpoints.find(c => c.id === id);
  if (!cp) return;
  state.currentCheckpoint = cp;
  renderDetail(cp);
  showView('view-detail');
}

function renderDetail(cp) {
  const gold = cp.gold ? '<span class="gold-badge">⭐ Gold</span>' : '';
  const tags = (cp.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
  const date = new Date(cp.createdAt).toLocaleString();

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-name">${gold} ${esc(cp.name)}</div>
    <div class="detail-rating">${ratingBar(cp.rating)} <span class="rating-value">${cp.rating}/10</span></div>
    <div class="detail-date">${date}</div>
    ${tags ? `<div class="cp-tags detail-tags">${tags}</div>` : ''}
    ${cp.notes ? `<div class="detail-section"><div class="detail-label">Notes</div><div class="detail-notes">${esc(cp.notes)}</div></div>` : ''}
    <div class="detail-section">
      <div class="detail-label">Saved text</div>
      <div class="detail-text">${esc(cp.text)}</div>
    </div>
  `;
}

function copyRestorePrompt(cp) {
  const tags = (cp.tags || []).map(t => '#' + t).join(' ');
  const gold = cp.gold ? '⭐ GOLD checkpoint' : '';
  const prompt = `
── CHECKPOINT RESTORE ──────────────────────────────
Project : ${state.currentProject.name}
Name    : ${cp.name}${gold ? '\nStatus  : ' + gold : ''}
Rating  : ${cp.rating}/10
Date    : ${new Date(cp.createdAt).toLocaleString()}${tags ? '\nTags    : ' + tags : ''}${cp.notes ? '\nNotes   : ' + cp.notes : ''}
────────────────────────────────────────────────────

${cp.text}

────────────────────────────────────────────────────
Continue from here. The above is the exact point where the project was at its best. Keep this direction.
  `.trim();

  navigator.clipboard.writeText(prompt).then(() => {
    showToast('Prompt copied! Paste it in a new chat 🚀');
  });
}

// ─── Rating Stars ─────────────────────────────────────────────────────────────

function buildRatingStars() {
  const container = document.getElementById('rating-stars');
  container.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const dot = document.createElement('button');
    dot.className = 'rating-dot';
    dot.dataset.val = i;
    dot.title = `${i}/10`;
    dot.addEventListener('click', () => setRating(i));
    container.appendChild(dot);
  }
  setRating(5);
}

function setRating(val) {
  state.rating = val;
  document.getElementById('rating-value').textContent = val;
  document.querySelectorAll('.rating-dot').forEach(d => {
    d.classList.toggle('active', parseInt(d.dataset.val) <= val);
  });
}

function ratingBar(val) {
  let dots = '';
  for (let i = 1; i <= 10; i++) {
    dots += `<span class="rating-dot-sm ${i <= val ? 'active' : ''}"></span>`;
  }
  return `<span class="rating-bar-sm">${dots}</span>`;
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // new project modal
  document.getElementById('btn-new-project').addEventListener('click', () => {
    document.getElementById('modal-project').classList.remove('hidden');
    document.getElementById('project-name-input').value = '';
    document.getElementById('project-name-input').focus();
  });
  document.getElementById('btn-cancel-project').addEventListener('click', () => {
    document.getElementById('modal-project').classList.add('hidden');
  });
  document.getElementById('btn-confirm-project').addEventListener('click', async () => {
    const name = document.getElementById('project-name-input').value.trim();
    if (!name) return;
    document.getElementById('modal-project').classList.add('hidden');
    await createProject(name);
  });
  document.getElementById('project-name-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-project').click();
  });

  // project list clicks
  document.getElementById('project-list').addEventListener('click', (e) => {
    const delBtn = e.target.closest('.del-project');
    if (delBtn) { deleteProject(delBtn.dataset.id); return; }
    const main = e.target.closest('.item-main');
    if (main) {
      const proj = state.projects.find(p => p.id === main.dataset.id);
      if (proj) openProject(proj);
    }
  });

  // back buttons
  document.getElementById('btn-back-projects').addEventListener('click', () => {
    loadProjects();
    showView('view-projects');
  });
  document.getElementById('btn-back-save').addEventListener('click', () => {
    resetForm();
    showView('view-checkpoints');
  });
  document.getElementById('btn-back-detail').addEventListener('click', () => showView('view-checkpoints'));

  // save checkpoint button
  document.getElementById('btn-new-checkpoint').addEventListener('click', () => {
    state.editMode = false;
    resetForm();
    showView('view-save');
  });
  document.getElementById('btn-save-cp').addEventListener('click', saveCheckpoint);

  // checkpoint list clicks
  document.getElementById('checkpoint-list').addEventListener('click', (e) => {
    const main = e.target.closest('.cp-main');
    if (main) openCheckpoint(main.dataset.id);
  });

  // detail actions
  document.getElementById('btn-copy-prompt').addEventListener('click', () => {
    copyRestorePrompt(state.currentCheckpoint);
  });
  document.getElementById('btn-delete-cp').addEventListener('click', () => {
    deleteCheckpoint(state.currentCheckpoint.id);
  });
  document.getElementById('btn-edit-cp').addEventListener('click', () => {
    const cp = state.currentCheckpoint;
    state.editMode = true;
    document.getElementById('cp-name').value = cp.name;
    document.getElementById('cp-text').value = cp.text;
    document.getElementById('cp-notes').value = cp.notes || '';
    document.getElementById('cp-tags').value = (cp.tags || []).map(t => '#' + t).join(' ');
    document.getElementById('cp-gold').checked = cp.gold;
    setRating(cp.rating);
    showView('view-save');
  });

  // filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderCheckpoints();
    });
  });
  document.getElementById('tag-filter').addEventListener('input', (e) => {
    state.tagFilter = e.target.value.trim();
    renderCheckpoints();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showView(id) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('hidden', v.id !== id);
    v.classList.toggle('active', v.id === id);
  });
}

function resetForm() {
  document.getElementById('cp-name').value = '';
  document.getElementById('cp-text').value = '';
  document.getElementById('cp-notes').value = '';
  document.getElementById('cp-tags').value = '';
  document.getElementById('cp-gold').checked = false;
  setRating(5);
  state.editMode = false;
}

function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

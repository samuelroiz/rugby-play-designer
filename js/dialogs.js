// Small helpers shared by the app's dialogs.

const $ = id => document.getElementById(id);

// A click outside the box (on its backdrop) closes it.
export function closeOnClickOutside(dialog) {
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  });
}

// In-app confirm, so the page never opens a native dialog. Resolves true for OK.
export function askConfirm(message, ok = 'OK') {
  const dialog = $('confirm-dialog');
  $('confirm-message').textContent = message;
  $('confirm-ok').textContent = ok;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

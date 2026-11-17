import type { DocumentDisposition } from '../app/DocumentLifecycle';

/** A modal decision with a non-destructive Escape/Cancel default. */
export function chooseDocumentDisposition(name: string, action: string): Promise<DocumentDisposition> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'document-transition-dialog';
    dialog.setAttribute('aria-label', 'Unsaved changes');
    const title = document.createElement('h2');
    title.textContent = 'Save your changes?';
    const message = document.createElement('p');
    message.textContent = `“${name}” has unsaved changes. Save them before ${action.toLowerCase()}?`;
    const actions = document.createElement('div');
    actions.className = 'document-transition-dialog__actions';
    let settled = false;
    const finish = (choice: DocumentDisposition): void => {
      if (settled) return;
      settled = true;
      dialog.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(choice);
    };
    for (const [label, choice] of [
      ['Cancel', 'cancel'], ['Discard changes', 'discard'], ['Save', 'save'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => finish(choice));
      if (choice === 'cancel') button.autofocus = true;
      actions.appendChild(button);
    }
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish('cancel'); });
    dialog.addEventListener('close', () => finish('cancel'));
    // Global modeling shortcuts must not change the document behind this modal.
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    dialog.append(title, message, actions);
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

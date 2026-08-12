import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('WelcomeOverlay');

export interface WelcomeOverlayAction {
  label: string;
  description: string;
  onTrigger: () => void;
  isDisabled?: () => boolean;
}

export interface WelcomeOverlayOptions {
  container?: HTMLElement;
  actions: WelcomeOverlayAction[];
  dismissed?: boolean;
  onDismiss?: () => void;
}

export class WelcomeOverlay {
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private actions: WelcomeOverlayAction[];
  private dismissed = false;
  private isVisible = false;
  private readonly onDismiss: (() => void) | undefined;

  constructor(options: WelcomeOverlayOptions) {
    this.actions = options.actions;
    this.dismissed = options.dismissed ?? false;
    this.onDismiss = options.onDismiss;

    if (options.container) {
      this.attachTo(options.container);
    }
  }

  attachTo(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  refresh(): void {
    if (!this.container) {
      return;
    }

    const wasVisible = this.getIsVisible();
    this.render();
    this.isVisible = wasVisible && !this.dismissed;
    if (this.root) {
      this.root.hidden = !this.isVisible;
    }
  }

  setVisible(isVisible: boolean): void {
    if (!this.root) {
      return;
    }

    const shouldShow = isVisible && !this.dismissed;
    const wasVisible = this.isVisible;
    this.isVisible = shouldShow;
    this.root.hidden = !shouldShow;

    void wasVisible;
  }

  dismiss(): void {
    this.dismissed = true;
    this.setVisible(false);
    this.onDismiss?.();
  }

  resetDismissed(): void {
    this.dismissed = false;
  }

  getIsVisible(): boolean {
    return !!this.root && this.isVisible && !this.root.hidden;
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.container = null;
    this.isVisible = false;
    log.debug('WelcomeOverlay disposed');
  }

  private render(): void {
    if (!this.container) {
      return;
    }

    this.root?.remove();
    this.root = document.createElement('div');
    this.root.className = 'welcome-overlay';
    this.root.hidden = true;
    // The overlay lives inside the viewport element, whose OrbitControls listen for
    // bubbling pointer events. Do not let a button press start pointer capture for
    // camera navigation; captured pointers suppress the button's eventual click.
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.root.addEventListener('wheel', (event) => event.stopPropagation());
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) {
        this.dismiss();
      }
    });

    const card = document.createElement('div');
    card.className = 'welcome-overlay__card';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-labelledby', 'welcome-overlay-title');
    card.setAttribute('aria-describedby', 'welcome-overlay-description');
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.dismiss();
        return;
      }

    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'welcome-overlay__close';
    closeButton.setAttribute('aria-label', 'Dismiss quick start');
    closeButton.title = 'Hide quick start';
    closeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dismiss();
    });
    closeButton.textContent = 'Close';
    card.appendChild(closeButton);

    const eyebrow = document.createElement('div');
    eyebrow.className = 'welcome-overlay__eyebrow';
    eyebrow.textContent = 'Quick start';
    card.appendChild(eyebrow);

    const title = document.createElement('h2');
    title.id = 'welcome-overlay-title';
    title.className = 'welcome-overlay__title';
    title.textContent = 'Start a design';
    card.appendChild(title);

    const description = document.createElement('p');
    description.id = 'welcome-overlay-description';
    description.className = 'welcome-overlay__description';
    description.textContent = 'Choose one starting point.';
    card.appendChild(description);

    const actions = document.createElement('div');
    actions.className = 'welcome-overlay__actions';

    for (const action of this.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'welcome-overlay__button';
      button.textContent = action.label;
      button.title = action.description;
      button.disabled = action.isDisabled?.() ?? false;
      if (button.disabled) {
        button.dataset.disabled = 'true';
        button.title = `${action.description} (unavailable until geometry exists)`;
      }
      button.addEventListener('click', action.onTrigger);
      actions.appendChild(button);
    }

    card.appendChild(actions);

    const orientation = document.createElement('p');
    orientation.className = 'welcome-overlay__hint';
    orientation.textContent =
      'Tools are grouped at the top — Create, Transform, Combine, and more; click a group header to fold it open or closed. The left panel lists your Objects; open an Assembly there to reveal the pieces that make it up. Use Combine to fuse overlapping bodies into one solid, or Joint for real woodworking joinery.';
    card.appendChild(orientation);

    this.root.appendChild(card);
    this.container.appendChild(this.root);
    log.debug('WelcomeOverlay rendered');
  }

}

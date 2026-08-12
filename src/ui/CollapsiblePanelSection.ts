let sectionSequence = 0;

export interface CollapsiblePanelSectionOptions {
  expanded?: boolean;
  testId?: string;
  /** One-line plain-language description shown under the title. Use it to make
   *  a section's purpose obvious without forcing the user to expand it. */
  description?: string;
  /** Hidden sections are removed from the panel entirely (display:none) until
   *  shown again. Used for contextual sections so the default panels aren't a
   *  wall of collapsed headers with nothing inside. */
  hidden?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export class CollapsiblePanelSection {
  readonly element: HTMLElement;
  readonly content: HTMLElement;

  private readonly toggleButton: HTMLButtonElement;
  private readonly indicator: HTMLElement;
  private readonly onExpandedChange: ((expanded: boolean) => void) | undefined;

  constructor(
    parent: HTMLElement,
    title: string,
    options: CollapsiblePanelSectionOptions = {}
  ) {
    this.onExpandedChange = options.onExpandedChange;
    sectionSequence += 1;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const contentId = `panel-section-${slug || 'section'}-${sectionSequence}`;

    this.element = document.createElement('section');
    this.element.className = 'panel-section';
    this.element.dataset.testid = options.testId ?? `panel-section-${slug}`;

    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'panel-section__toggle';
    this.toggleButton.setAttribute('aria-controls', contentId);
    // The description text lives inside the toggle for sighted users, but the
    // toggle's accessible name should be exactly the section title (so it can be
    // found by exact role/name lookups and announced cleanly by AT).
    this.toggleButton.setAttribute('aria-label', title);

    const heading = document.createElement('span');
    heading.className = 'panel-section__heading';
    const titleElement = document.createElement('span');
    titleElement.className = 'panel-section__title';
    titleElement.textContent = title;
    heading.appendChild(titleElement);

    if (options.description) {
      const descriptionElement = document.createElement('span');
      descriptionElement.className = 'panel-section__description';
      descriptionElement.textContent = options.description;
      heading.appendChild(descriptionElement);
    }

    this.toggleButton.appendChild(heading);

    this.indicator = document.createElement('span');
    this.indicator.className = 'panel-section__indicator';
    this.indicator.setAttribute('aria-hidden', 'true');
    this.toggleButton.appendChild(this.indicator);

    this.content = document.createElement('div');
    this.content.id = contentId;
    this.content.className = 'panel-section__content';

    this.toggleButton.addEventListener('click', () => {
      this.setExpanded(!this.isExpanded(), true);
    });

    this.element.append(this.toggleButton, this.content);
    parent.appendChild(this.element);
    this.setExpanded(options.expanded ?? false);
    this.setHidden(options.hidden ?? false);
  }

  isExpanded(): boolean {
    return this.toggleButton.getAttribute('aria-expanded') === 'true';
  }

  setExpanded(expanded: boolean, notify = false): void {
    this.toggleButton.setAttribute('aria-expanded', String(expanded));
    this.content.hidden = !expanded;
    this.element.dataset.expanded = String(expanded);
    this.indicator.textContent = expanded ? '−' : '+';
    if (notify) this.onExpandedChange?.(expanded);
  }

  /** Completely remove the section from the panel layout (vs. collapse, which
   *  keeps the header visible). Hidden sections are not announced. */
  setHidden(hidden: boolean): void {
    this.element.hidden = hidden;
    this.element.dataset.hidden = String(hidden);
  }

  isHidden(): boolean {
    return this.element.hidden;
  }

  focusToggle(): void {
    this.toggleButton.focus();
  }
}

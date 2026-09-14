import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

export interface AppSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

let nextSelectId = 0;

@Component({
  selector: 'app-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-select' },
  template: `
    <button
      #trigger
      class="app-select-trigger"
      type="button"
      aria-haspopup="listbox"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      [attr.aria-activedescendant]="open() ? activeOptionId() : null"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown)="onTriggerKeydown($event)"
    >
      <span>{{ selectedLabel() }}</span>
      <span class="app-select-caret" [class.open]="open()" aria-hidden="true"></span>
    </button>

    @if (open()) {
      <div
        class="app-select-panel"
        [id]="panelId"
        role="listbox"
        [attr.aria-label]="ariaLabel()"
      >
        @for (option of options(); track option.value; let optionIndex = $index) {
          <button
            class="app-select-option"
            type="button"
            role="option"
            tabindex="-1"
            [id]="optionId(optionIndex)"
            [class.active]="activeIndex() === optionIndex"
            [attr.aria-selected]="value() === option.value"
            [disabled]="option.disabled"
            [style.--option-index]="optionIndex"
            (mousedown)="$event.preventDefault()"
            (mouseenter)="activeIndex.set(optionIndex)"
            (click)="choose(option)"
          >
            {{ option.label }}
          </button>
        }
      </div>
    }
  `,
})
export class AppSelect implements AfterViewInit {
  readonly options = input<readonly AppSelectOption[]>([]);
  readonly value = input('');
  readonly valueChange = output<string>();
  readonly ariaLabel = input.required<string>();
  readonly placeholder = input('Select');
  readonly disabled = input(false);
  readonly autoFocus = input(false);

  readonly open = signal(false);
  readonly activeIndex = signal(0);
  readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  readonly panelId = `app-select-${++nextSelectId}`;
  readonly selectedLabel = computed(() =>
    this.options().find((option) => option.value === this.value())?.label ?? this.placeholder(),
  );
  readonly activeOptionId = computed(() => this.optionId(this.activeIndex()));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterViewInit(): void {
    if (this.autoFocus()) queueMicrotask(() => this.trigger()?.nativeElement.focus());
  }

  @HostListener('document:pointerdown', ['$event'])
  closeFromOutside(event: PointerEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('document:keydown.escape')
  closeFromEscape(): void {
    this.close();
  }

  toggle(): void {
    if (this.open()) this.close();
    else this.openPanel();
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open()) this.openPanel(event.key === 'ArrowUp' ? -1 : 1);
      else this.move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!this.open()) return;
      event.preventDefault();
      this.activeIndex.set(event.key === 'Home' ? this.firstEnabledIndex() : this.lastEnabledIndex());
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && this.open()) {
      event.preventDefault();
      const option = this.options()[this.activeIndex()];
      if (option) this.choose(option);
      return;
    }
    if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  choose(option: AppSelectOption): void {
    if (option.disabled) return;
    this.valueChange.emit(option.value);
    this.close();
    this.trigger()?.nativeElement.focus();
  }

  optionId(index: number): string {
    return `${this.panelId}-option-${index}`;
  }

  private openPanel(direction = 1): void {
    const selectedIndex = this.options().findIndex((option) => option.value === this.value() && !option.disabled);
    this.activeIndex.set(selectedIndex >= 0 ? selectedIndex : direction < 0 ? this.lastEnabledIndex() : this.firstEnabledIndex());
    this.open.set(true);
  }

  private close(): void {
    this.open.set(false);
  }

  private move(direction: 1 | -1): void {
    const options = this.options();
    if (!options.length) return;
    let index = this.activeIndex();
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index].disabled) {
        this.activeIndex.set(index);
        return;
      }
    }
  }

  private firstEnabledIndex(): number {
    const index = this.options().findIndex((option) => !option.disabled);
    return Math.max(0, index);
  }

  private lastEnabledIndex(): number {
    for (let index = this.options().length - 1; index >= 0; index -= 1) {
      if (!this.options()[index].disabled) return index;
    }
    return 0;
  }
}

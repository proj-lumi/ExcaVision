import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AppSelect } from './app-select';

describe('AppSelect', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppSelect] }).compileComponents();
  });

  it('opens the option content and emits a selection', () => {
    const fixture = TestBed.createComponent(AppSelect);
    fixture.componentRef.setInput('ariaLabel', 'Filter state');
    fixture.componentRef.setInput('value', 'all');
    fixture.componentRef.setInput('options', [
      { value: 'all', label: 'All states' },
      { value: 'active', label: 'Active' },
    ]);
    const selected: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value) => selected.push(value));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.app-select-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.app-select-panel')).toBeTruthy();

    (fixture.nativeElement.querySelectorAll('.app-select-option')[1] as HTMLButtonElement).click();
    expect(selected).toEqual(['active']);
  });

  it('supports arrow-key selection from the trigger', () => {
    const fixture = TestBed.createComponent(AppSelect);
    fixture.componentRef.setInput('ariaLabel', 'Filter stage');
    fixture.componentRef.setInput('value', 'all');
    fixture.componentRef.setInput('options', [
      { value: 'all', label: 'All stages' },
      { value: 'paused', label: 'Paused', disabled: true },
      { value: 'planning', label: 'Planning' },
    ]);
    const selected: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value) => selected.push(value));
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.app-select-trigger') as HTMLButtonElement;
    const focus = vi.spyOn(trigger, 'focus');
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-0');

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-2');
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(selected).toEqual(['planning']);
    expect(focus).toHaveBeenCalled();
  });

  it('closes on Escape and an outside pointer interaction', () => {
    const fixture = TestBed.createComponent(AppSelect);
    fixture.componentRef.setInput('ariaLabel', 'Filter state');
    fixture.componentRef.setInput('options', [{ value: 'all', label: 'All states' }]);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.app-select-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);

    trigger.click();
    fixture.detectChanges();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
  });
});

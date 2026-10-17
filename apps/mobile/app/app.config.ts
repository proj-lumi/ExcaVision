export default defineAppConfig({
  ui: {
    colors: {
      primary: 'orange',
      neutral: 'slate'
    },
    button: {
      variants: {
        size: {
          xs: { base: 'min-h-9 px-2.5 py-1.5 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          sm: { base: 'min-h-10 px-3 py-2 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          md: { base: 'min-h-10 px-3 py-2 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          lg: { base: 'min-h-11 px-3.5 py-2.5 text-sm gap-2', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          xl: { base: 'min-h-11 px-3.5 py-2.5 text-sm gap-2', leadingIcon: 'size-4', trailingIcon: 'size-4' }
        }
      },
      defaultVariants: { size: 'md' }
    },
    input: {
      variants: {
        size: {
          xs: { base: 'min-h-9 px-2.5 py-1.5 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          sm: { base: 'min-h-10 px-3 py-2 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          md: { base: 'min-h-10 px-3 py-2 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          lg: { base: 'min-h-11 px-3.5 py-2.5 text-sm gap-2', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          xl: { base: 'min-h-11 px-3.5 py-2.5 text-sm gap-2', leadingIcon: 'size-4', trailingIcon: 'size-4' }
        }
      },
      defaultVariants: { size: 'md' }
    },
    select: {
      variants: {
        size: {
          xs: { base: 'min-h-9 px-2.5 py-1.5 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4', item: 'p-2 text-sm gap-2', itemLeadingIcon: 'size-4', itemTrailingIcon: 'size-4' },
          sm: { base: 'min-h-10 px-3 py-2 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4', item: 'p-2 text-sm gap-2', itemLeadingIcon: 'size-4', itemTrailingIcon: 'size-4' },
          md: { base: 'min-h-10 px-3 py-2 text-sm gap-1.5', leadingIcon: 'size-4', trailingIcon: 'size-4', item: 'p-2 text-sm gap-2', itemLeadingIcon: 'size-4', itemTrailingIcon: 'size-4' },
          lg: { base: 'min-h-11 px-3.5 py-2.5 text-sm gap-2', leadingIcon: 'size-4', trailingIcon: 'size-4', item: 'p-2 text-sm gap-2', itemLeadingIcon: 'size-4', itemTrailingIcon: 'size-4' },
          xl: { base: 'min-h-11 px-3.5 py-2.5 text-sm gap-2', leadingIcon: 'size-4', trailingIcon: 'size-4', item: 'p-2 text-sm gap-2', itemLeadingIcon: 'size-4', itemTrailingIcon: 'size-4' }
        }
      },
      defaultVariants: { size: 'md' }
    },
    card: {
      slots: {
        root: 'bg-elevated ring ring-accented dark:ring-2 dark:ring-slate-600/80',
        header: 'p-3 sm:p-4',
        body: 'p-3 sm:p-4',
        footer: 'p-3 sm:p-4'
      },
      variants: {
        variant: {
          outline: { root: 'bg-elevated ring ring-accented dark:ring-2 dark:ring-slate-600/80 divide-y divide-accented' },
          soft: { root: 'bg-muted ring ring-accented dark:ring-2 dark:ring-slate-600/80 divide-y divide-accented' },
          subtle: { root: 'bg-elevated ring ring-accented dark:ring-2 dark:ring-slate-600/80 divide-y divide-accented' }
        }
      },
      defaultVariants: { variant: 'subtle' }
    },
    modal: {
      slots: {
        content: 'min-h-0 max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-h-[calc(100dvh-4rem)]',
        header: 'shrink-0',
        body: 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
        footer: 'shrink-0'
      }
    }
  }
})

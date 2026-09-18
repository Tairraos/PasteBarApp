import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Link } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { NodeApi, NodeRendererProps } from '~/components/libs/react-arborist'

import styles from './menu-tree.module.css'
import MenuInputNode from './MenuInput'

export default function Node({ node, style, dragHandle }: NodeRendererProps<unknown>) {
  const { t } = useTranslation()
  return (
    <div
      ref={dragHandle}
      style={style}
      className={clsx(
        styles.node,
        node.state,
        'flex items-center w-full transition-all duration-100 ease-in'
      )}
      onClick={() => node.isInternal && node.toggle()}
    >
      {node.level > 0 && <div />}

      <div>
        {!node.isLeaf && !node.isOpen && (
          <Folder width={17} height={17} className="mr-2" />
        )}
        {!node.isLeaf && node.isOpen && (
          <FolderOpen width={17} height={17} className="mr-2" />
        )}
      </div>

      <div className="flex items-center justify-start w-full overflow-hidden mr-4">
        {!node.data.isSeparator ? (
          <>
            {!node.isEditing ? (
              // Selected colours go HERE, on the element that holds the text, not on the row.
              //
              // The row carries `not-active-background` including `dark:text-slate-600`, and
              // Tailwind compiles a dark variant to `:is(.dark .dark\:text-slate-600)` — four
              // class-level selectors. A rule in `menu-tree.module.css` aimed at the row
              // cannot outrank that without `!important`, so setting `color` there left the
              // background selected while the text stayed the same dark grey as the fill:
              // the selected item was invisible rather than merely hard to read. Styling the
              // text element directly, in the idiom this file already uses, sidesteps the
              // specificity contest instead of escalating it.
              <div
                className={`overflow-hidden overflow-ellipsis text-[15px] ${
                  node.data.isDisabled
                    ? 'text-gray-500/60'
                    : node.isSelected
                      ? 'text-slate-900 dark:text-slate-50'
                      : ''
                } `}
              >
                {node.data.name}
                {node.data.isClip && (
                  <div
                    title={t('Menu is a link to a clip', { ns: 'menus' })}
                    className="inline-block"
                  >
                    <Link
                      size={13}
                      className="inline ml-2 mt-[-3px] dark:text-slate-500 text-slate-400"
                    />
                  </div>
                )}
              </div>
            ) : (
              <MenuInputNode node={node} />
            )}
          </>
        ) : (
          <hr className="h-[1px] border-t-0 bg-slate-600 opacity-30 dark:opacity-70 w-full" />
        )}
      </div>
      <FolderArrow node={node} />
    </div>
  )
}

function FolderArrow({ node }: { node: NodeApi }) {
  if (node.isLeaf) return <div />
  return node.isOpen ? (
    <ChevronDown width={22} className="mr-3" />
  ) : (
    <ChevronRight width={22} className="mr-3" />
  )
}

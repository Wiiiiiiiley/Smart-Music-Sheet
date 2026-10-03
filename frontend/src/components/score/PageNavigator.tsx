import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PageNavigatorProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
}

export default function PageNavigator({ currentPage, totalPages, onPageChange, disabled = false }: PageNavigatorProps) {
  return (
    <div className="bg-white border-t border-gray-200 px-4 h-12 flex items-center justify-between flex-shrink-0">
      <button
        type="button"
        aria-label="上一页"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={disabled || currentPage <= 1}
        className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <span className="text-sm text-gray-600" aria-live="polite">
        第 <span className="font-medium text-gray-900">{currentPage}</span> / {totalPages} 页
      </span>

      <button
        type="button"
        aria-label="下一页"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={disabled || currentPage >= totalPages}
        className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  )
}

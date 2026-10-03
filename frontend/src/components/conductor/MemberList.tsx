import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { apiFetch } from '../../utils/api'
import { useAppStore } from '../../stores/appStore'

interface Member {
  id: string
  name: string
  role: string
  section?: string
  instrument?: string
}

interface MemberListProps {
  ensembleId: string
  onSelectSection: (section: string | null) => void
  selectedSection: string | null
}

export default function MemberList({ ensembleId, onSelectSection, selectedSection }: MemberListProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [sections, setSections] = useState<string[]>([])
  const ensemble = useAppStore((state) => state.currentEnsemble)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/ensembles/${ensembleId}`)
      .then((res) => {
        if (!res.ok) throw new Error('读取成员失败')
        return res.json()
      })
      .then(data => {
        if (cancelled) return
        setMembers(data.members || [])
        const uniqueSections = [...new Set(data.members?.map((m: Member) => m.section).filter(Boolean))]
        setSections(uniqueSections as string[])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [ensembleId])

  useEffect(() => {
    if (ensemble?.id !== ensembleId) return
    setMembers(ensemble.members)
    setSections([...new Set(ensemble.members.map((member) => member.section).filter((section): section is string => Boolean(section)))])
  }, [ensemble, ensembleId])

  const groupedMembers = sections.reduce((acc, section) => {
    acc[section] = members.filter(m => m.section === section)
    return acc
  }, {} as Record<string, Member[]>)

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
        <Users className="w-4 h-4" />
        声部列表
      </h3>

      {/* 全体选择 */}
      <button
        onClick={() => onSelectSection(null)}
        className={`w-full p-2 rounded-lg text-left flex items-center gap-2 ${
          selectedSection === null ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100'
        }`}
      >
        <Users className="w-4 h-4" />
        <span>全体成员</span>
      </button>

      {/* 按声部分组 */}
      <div className="space-y-2">
        {sections.map((section) => (
          <button
            key={section}
            onClick={() => onSelectSection(section)}
            className={`w-full p-2 rounded-lg text-left ${
              selectedSection === section ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{getSectionName(section)}</span>
              <span className="text-sm text-gray-500">
                {groupedMembers[section]?.length || 0} 人
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function getSectionName(section: string): string {
  const sectionMap: Record<string, string> = {
    violin1: '第一小提琴',
    violin2: '第二小提琴',
    viola: '中提琴',
    cello: '大提琴',
    bass: '低音提琴',
    flute: '长笛',
    oboe: '双簧管',
    clarinet: '单簧管',
    bassoon: '大管',
    horn: '圆号',
    trumpet: '小号',
    trombone: '长号',
    tuba: '大号',
    timpani: '定音鼓',
    percussion: '打击乐',
    piano: '钢琴',
    harp: '竖琴',
  }
  return sectionMap[section] || section
}

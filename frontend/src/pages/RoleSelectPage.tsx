import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, User, ArrowLeft } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useSocketStore } from '../stores/socketStore'
import { v4 as uuidv4 } from '../utils/uuid'

export default function RoleSelectPage() {
  const navigate = useNavigate()
  const { setCurrentUser, clearState } = useAppStore()
  const { disconnect } = useSocketStore()
  const [step, setStep] = useState<'role' | 'info'>('role')
  const [selectedRole, setSelectedRole] = useState<'CONDUCTOR' | 'PLAYER' | null>(null)
  const [name, setName] = useState('')
  const [instrument, setInstrument] = useState('')
  const [section, setSection] = useState('')

  const handleRoleSelect = (role: 'CONDUCTOR' | 'PLAYER') => {
    setSelectedRole(role)
    setStep('info')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRole || !name.trim()) return

    const user = {
      id: uuidv4(),
      name: name.trim(),
      role: selectedRole,
      instrument: instrument.trim() || undefined,
      section: section.trim() || undefined,
    }

    disconnect()
    clearState()
    setCurrentUser(user)
    
    if (selectedRole === 'CONDUCTOR') {
      navigate('/setup')
    } else {
      navigate('/player/join')
    }
  }

  return (
    <div className="min-h-full flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 h-14 flex items-center">
        <button 
          onClick={() => step === 'role' ? navigate('/') : setStep('role')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-5 h-5" />
          返回
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {step === 'role' ? (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">选择角色</h1>
                <p className="text-gray-600">请选择您在乐团中的角色</p>
              </div>

              <div className="grid gap-4">
                <button
                  onClick={() => handleRoleSelect('CONDUCTOR')}
                  className="panel p-6 text-left hover:border-music-conductor hover:shadow-md transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center group-hover:bg-red-200 transition-colors">
                      <Users className="w-7 h-7 text-music-conductor" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-lg text-gray-900">我是指挥</h2>
                      <p className="text-sm text-gray-600">创建乐团、上传乐谱、实时标记</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => handleRoleSelect('PLAYER')}
                  className="panel p-6 text-left hover:border-music-player hover:shadow-md transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-colors">
                      <User className="w-7 h-7 text-music-player" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-lg text-gray-900">我是乐手</h2>
                      <p className="text-sm text-gray-600">加入乐团、接收提示、同步乐谱</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="panel p-6 space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  {selectedRole === 'CONDUCTOR' ? '指挥信息' : '乐手信息'}
                </h1>
                <p className="text-gray-600">请输入您的基本信息</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    姓名 *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="请输入您的姓名"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>

                {selectedRole === 'PLAYER' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        乐器
                      </label>
                      <input
                        type="text"
                        value={instrument}
                        onChange={(e) => setInstrument(e.target.value)}
                        placeholder="例如：小提琴"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        声部
                      </label>
                      <select
                        value={section}
                        onChange={(e) => setSection(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="">请选择声部</option>
                        <option value="violin1">第一小提琴</option>
                        <option value="violin2">第二小提琴</option>
                        <option value="viola">中提琴</option>
                        <option value="cello">大提琴</option>
                        <option value="bass">低音提琴</option>
                        <option value="flute">长笛</option>
                        <option value="oboe">双簧管</option>
                        <option value="clarinet">单簧管</option>
                        <option value="bassoon">大管</option>
                        <option value="horn">圆号</option>
                        <option value="trumpet">小号</option>
                        <option value="trombone">长号</option>
                        <option value="tuba">大号</option>
                        <option value="timpani">定音鼓</option>
                        <option value="percussion">打击乐</option>
                        <option value="piano">钢琴</option>
                        <option value="harp">竖琴</option>
                      </select>
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('role')}
                  className="flex-1 btn-secondary"
                >
                  返回
                </button>
                <button
                  type="submit"
                  className="flex-1 btn-primary"
                  disabled={!name.trim()}
                >
                  继续
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

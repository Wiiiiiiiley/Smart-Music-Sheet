import { useNavigate } from 'react-router-dom'
import { Music, Users, Radio, Edit3, ArrowRight } from 'lucide-react'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-full flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Music className="w-8 h-8 text-primary-600" />
            <span className="text-xl font-bold text-gray-900">EduTempo</span>
          </div>
          <button 
            onClick={() => navigate('/role-select')}
            className="btn-primary flex items-center gap-2"
          >
            开始使用
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 bg-gradient-to-br from-primary-50 to-white py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            智能乐团排练系统
          </h1>
          <p className="text-lg md:text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            指挥实时标记 + 分声部音频提示 + 多端乐谱同步
            <br />
            让每一次排练都更高效
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={() => navigate('/role-select')}
              className="btn-conductor text-lg px-8 py-3"
            >
              我是指挥
            </button>
            <button 
              onClick={() => navigate('/role-select')}
              className="btn-primary text-lg px-8 py-3"
            >
              我是乐手
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-12">
            核心功能
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <FeatureCard 
              icon={<Edit3 className="w-8 h-8 text-primary-600" />}
              title="实时标记"
              description="指挥可在任意乐手谱面上圈画、批注，实时同步到所有客户端"
            />
            <FeatureCard 
              icon={<Radio className="w-8 h-8 text-primary-600" />}
              title="分声部提示"
              description="向指定声部或全体发送提示音、节拍器、示范音频"
            />
            <FeatureCard 
              icon={<Users className="w-8 h-8 text-primary-600" />}
              title="多端同步"
              description="支持 Web、iPad、Android 平板，乐谱自动同步"
            />
            <FeatureCard 
              icon={<Music className="w-8 h-8 text-primary-600" />}
              title="乐谱分页"
              description="显示 PDF、MusicXML 和 MXL 乐谱，按实际页数翻页"
            />
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-12">
            使用流程
          </h2>
          <div className="space-y-8">
            <Step 
              number={1}
              title="创建或加入乐团"
              description="指挥创建乐团并邀请成员，乐手通过链接或房间号加入"
            />
            <Step 
              number={2}
              title="上传乐谱"
              description="支持 PDF、MusicXML 和 MXL 格式，可附带参考音频"
            />
            <Step 
              number={3}
              title="开始排练"
              description="指挥可以实时标记、发送提示音，乐手在自己的设备上同步查看"
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-gray-400">
            EduTempo - 为非专业乐团打造的智能排练系统
          </p>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="panel p-6 text-center hover:shadow-md transition-shadow">
      <div className="flex justify-center mb-4">{icon}</div>
      <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  )
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center font-bold">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-gray-900 text-lg mb-1">{title}</h3>
        <p className="text-gray-600">{description}</p>
      </div>
    </div>
  )
}

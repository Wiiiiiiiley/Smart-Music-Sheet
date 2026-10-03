import { Volume2, VolumeX, Headphones } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import SectionTracks from '../audio/SectionTracks'
import CueHistory from '../audio/CueHistory'

export default function AudioMixer() {
  const { masterVolume, setMasterVolume, sectionVolumes, setSectionVolume } = useAppStore()

  const sections = [
    { id: 'live', name: '指挥讲话' },
    { id: 'metronome', name: '节拍器' },
    { id: 'demo', name: '示范音频' },
  ]

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
        <Headphones className="w-4 h-4" />
        音频设置
      </h3>

      {/* 主音量 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">主音量</label>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setMasterVolume(masterVolume === 0 ? 1 : 0)}
            className="p-1 rounded hover:bg-gray-100"
          >
            {masterVolume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={masterVolume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-sm w-10">{Math.round(masterVolume * 100)}%</span>
        </div>
      </div>

      {/* 各声道音量 */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-gray-700">声道控制</label>
        {sections.map((section) => {
          const volume = sectionVolumes[section.id] ?? 1
          return (
            <div key={section.id} className="flex items-center gap-2">
              <button 
                onClick={() => setSectionVolume(section.id, volume === 0 ? 1 : 0)}
                className="p-1 rounded hover:bg-gray-100"
              >
                {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <span className="text-sm w-16">{section.name}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={(e) => setSectionVolume(section.id, Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm w-10">{Math.round(volume * 100)}%</span>
            </div>
          )
        })}
      </div>

      <SectionTracks />
      <CueHistory />

      {/* 提示 */}
      <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
        <p>佩戴耳机以获得最佳体验</p>
      </div>
    </div>
  )
}

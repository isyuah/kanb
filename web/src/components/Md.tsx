import ReactMarkdown from 'react-markdown'
import './md.css'

/** Markdown 渲染（用于任务内容与进度文本的展示态） */
export default function Md({ children }: { children: string }) {
  return (
    <div className="kanb-md">
      <ReactMarkdown
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { ImageStudioController, StudioView } from "./studioController";

export function ImageProjectRail({
  controller,
  view,
}: {
  controller: ImageStudioController;
  view: StudioView;
}) {
  const [title, setTitle] = useState("");
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState(false);
  const id = useId();
  return (
    <nav aria-label="图像项目" className="space-y-4 p-3">
      <h2 className="text-sm font-semibold">项目与素材</h2>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) {
            void controller.createProject(title);
            setTitle("");
          }
        }}
      >
        <label htmlFor={`${id}-title`} className="sr-only">
          新项目名称
        </label>
        <Input
          id={`${id}-title`}
          value={title}
          placeholder="新项目名称"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!title.trim()}>
          新建项目
        </Button>
      </form>
      <ul className="space-y-1">
        {view.state.projects.map((project) => (
          <li key={project.id}>
            <Button
              variant={project.id === view.projectId ? "secondary" : "ghost"}
              className="w-full justify-start overflow-hidden"
              aria-current={project.id === view.projectId ? "page" : undefined}
              onClick={() => {
                setDeleting(false);
                void controller.selectProject(project.id);
              }}
            >
              <span className="truncate">{project.title}</span>
            </Button>
          </li>
        ))}
      </ul>
      {view.projectCursor && (
        <Button size="sm" variant="ghost" onClick={() => void controller.moreProjects()}>
          加载更多项目
        </Button>
      )}
      {view.projectId && (
        <details>
          <summary className="cursor-pointer text-xs focus-visible:ring-2 focus-visible:ring-ring">
            管理当前项目
          </summary>
          <div className="space-y-2 pt-2">
            <label htmlFor={`${id}-rename`} className="sr-only">
              项目新名称
            </label>
            <Input
              id={`${id}-rename`}
              value={rename}
              placeholder="项目新名称"
              onChange={(event) => setRename(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!rename.trim()}
              onClick={() => void controller.renameProject(rename)}
            >
              重命名
            </Button>
            {deleting ? (
              <div role="alert" className="space-y-2 text-xs">
                <p>删除项目及其历史引用？本地草稿也会清理。</p>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setDeleting(false);
                    void controller.deleteProject();
                  }}
                >
                  确认删除项目
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>
                  保留项目
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
                删除项目
              </Button>
            )}
          </div>
        </details>
      )}
      {view.draft.inputs.length > 0 && (
        <div>
          <h3 className="text-xs font-medium">当前素材</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {view.draft.inputs.length} 张已保存的输入图片，可在创作区管理。
          </p>
        </div>
      )}
    </nav>
  );
}

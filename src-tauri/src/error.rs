use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Every command returns this. Serialized as `{ kind, message }`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Ошибка ввода-вывода: {0}")]
    Io(String),
    #[error("Путь не существует или недоступен: {0}")]
    InvalidPath(String),
    #[error("Некорректный аргумент: {0}")]
    InvalidArgument(String),
    #[error("Не удалось запустить «{program}»: {message}")]
    Spawn { program: String, message: String },
    #[error("Превышено время ожидания: {0}")]
    Timeout(String),
    #[error("Папка не является git-репозиторием")]
    NotGitRepo,
    #[error("git: {0}")]
    Git(String),
    #[error(
        "Android SDK не найден. Задайте ANDROID_HOME или sdk.dir в local.properties, \
         либо установите SDK через Android Studio"
    )]
    SdkNotFound,
    #[error("В Android SDK нет «{0}». Установите компонент через SDK Manager")]
    SdkToolMissing(String),
    #[error("adb: {0}")]
    Adb(String),
    #[error("Эмулятор: {0}")]
    Emulator(String),
    #[error("В проекте нет gradlew — это не Gradle-проект или wrapper не закоммичен")]
    GradlewNotFound,
    #[error("{0}")]
    Gradle(String),
    #[error("Уже выполняется другая задача")]
    TaskAlreadyRunning,
    #[error("Отменено")]
    Cancelled,
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Io(_) => "io",
            AppError::InvalidPath(_) => "invalidPath",
            AppError::InvalidArgument(_) => "invalidArgument",
            AppError::Spawn { .. } => "spawn",
            AppError::Timeout(_) => "timeout",
            AppError::NotGitRepo => "notGitRepo",
            AppError::Git(_) => "git",
            AppError::SdkNotFound => "sdkNotFound",
            AppError::SdkToolMissing(_) => "sdkToolMissing",
            AppError::Adb(_) => "adb",
            AppError::Emulator(_) => "emulator",
            AppError::GradlewNotFound => "gradlewNotFound",
            AppError::Gradle(_) => "gradle",
            AppError::TaskAlreadyRunning => "taskAlreadyRunning",
            AppError::Cancelled => "cancelled",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

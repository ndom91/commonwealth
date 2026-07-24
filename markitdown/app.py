import logging
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import BadZipFile, ZipFile

from fastapi import FastAPI, File, HTTPException, UploadFile
from markitdown import MarkItDown

app = FastAPI()
converter = MarkItDown()
logger = logging.getLogger(__name__)
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_MARKDOWN_BYTES = 20 * 1024 * 1024
ARCHIVE_SUFFIXES = {".docx", ".pptx", ".xlsx"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/convert")
async def convert(file: UploadFile = File(...)) -> dict[str, str]:
    suffix = Path(file.filename or "document").suffix
    with NamedTemporaryFile(suffix=suffix) as temporary_file:
        temporary_file.write(await file.read())
        temporary_file.flush()
        if suffix.lower() in ARCHIVE_SUFFIXES:
            validate_archive(temporary_file.name)
        try:
            result = converter.convert(temporary_file.name)
            markdown = result.text_content
        except Exception as error:
            logger.exception("document_conversion_failed filename=%r", file.filename)
            raise HTTPException(status_code=500, detail="Document conversion service failed; retry later") from error

    if len(markdown.encode("utf-8")) > MAX_MARKDOWN_BYTES:
        raise HTTPException(status_code=422, detail="Converted document exceeds the Markdown size limit")
    return {"markdown": markdown}


def validate_archive(path: str) -> None:
    try:
        with ZipFile(path) as archive:
            uncompressed_size = sum(entry.file_size for entry in archive.infolist())
    except BadZipFile as error:
        raise HTTPException(status_code=422, detail="Document archive is invalid") from error

    if uncompressed_size > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
        raise HTTPException(status_code=422, detail="Document archive expands beyond the allowed size")

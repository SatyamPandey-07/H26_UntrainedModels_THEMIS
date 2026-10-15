# Distribution name → import name

Some PyPI distributions install a module with a different name. Names are PEP 503 normalised
(lowercase, runs of `-`, `_`, `.` become `-`). When a distribution is missing here the engine falls back to
replacing `-` with `_` and stripping a `python-` / `py-` prefix or `-python` / `-py` suffix; confirm the
guess against `modules-imported-in-repo.txt`.

| Distribution          | Import name(s)                |
| --------------------- | ----------------------------- |
| `attrs`               | `attr`, `attrs`               |
| `beautifulsoup4`      | `bs4`                         |
| `django-cors-headers` | `corsheaders`                 |
| `djangorestframework` | `rest_framework`              |
| `grpcio`              | `grpc`                        |
| `mysqlclient`         | `MySQLdb`                     |
| `opencv-python`       | `cv2`                         |
| `pillow`              | `PIL`                         |
| `protobuf`            | `google.protobuf`             |
| `psycopg2-binary`     | `psycopg2`                    |
| `pycryptodome`        | `Crypto`                      |
| `pyjwt`               | `jwt`                         |
| `pymongo`             | `pymongo`, `bson`, `gridfs`   |
| `pyopenssl`           | `OpenSSL`                     |
| `pyserial`            | `serial`                      |
| `pyyaml`              | `yaml`                        |
| `pyzmq`               | `zmq`                         |
| `python-dateutil`     | `dateutil`                    |
| `python-dotenv`       | `dotenv`                      |
| `python-jose`         | `jose`                        |
| `python-magic`        | `magic`                       |
| `python-multipart`    | `multipart`                   |
| `python-slugify`      | `slugify`                     |
| `ruamel-yaml`         | `ruamel.yaml`                 |
| `scikit-image`        | `skimage`                     |
| `scikit-learn`        | `sklearn`                     |
| `setuptools`          | `setuptools`, `pkg_resources` |
| `typing-extensions`   | `typing_extensions`           |
